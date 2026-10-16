import { defineModel } from "./define-model.js";
import { defaultNamingStrategy } from "./naming.js";
import { defaultFieldTypeRegistry } from "../fields/default-registry.js";
import { InvalidModelDefinitionError, ModelConflictError, UnknownModelError } from "./errors.js";
import { META_TABLE_PREFIX } from "../meta/reserved-tables.js";
import { classifyDefinition, collectMixinNames, dependentsOf, foldModel, layerLabel, requirementsOf } from "./inheritance.js";

/**
 * Holds registered model descriptors, keyed by model name. This is the
 * in-memory metamodel: the source of truth Phase 3 (schema sync) and
 * Phase 4 (persisting the registry itself into `_meta_models`/
 * `_meta_fields`) will read from.
 *
 * A class rather than a bare object/singleton so multiple independent
 * registries can exist - useful for tests, and later for multi-tenant
 * setups where different tenants might register different model sets.
 *
 * ## Inheritance and definition order
 *
 * A model is really a stack of layers (see models/inheritance.js): its
 * own definition plus any extensions from other packages, with mixins
 * expanded. `getModel()` returns the folded, validated result.
 *
 * Definitions may arrive in ANY order. One that depends on something
 * not defined yet - an extension whose base hasn't been registered, a
 * model whose mixin hasn't - waits, and is applied the moment its
 * dependencies exist. That matters because the packages contributing
 * to a model are usually imported in an order nobody controls. Call
 * assertResolved() once everything has been registered (createClient,
 * sync() and the CLI do) to turn "still waiting on X" into an error.
 *
 * Every change is atomic: the new layer is applied, and the model plus
 * everything that mixes it in is rebuilt, and only if ALL of that
 * validates does the registry change. An extension that would break a
 * model that inherits from the one it extends is rejected whole.
 */
export class ModelRegistry {
  #specs = new Map(); // name -> { abstract, layers: [{ kind, def, origin }] }  - every defined model, abstract or not
  #models = new Map(); // name -> built descriptor  - concrete models only
  #tableOwners = new Map(); // tableName -> modelName
  #pending = []; // layers waiting on definitions that don't exist yet
  #namingStrategy;
  #fieldTypeRegistry;

  /**
   * @param {Object} [options]
   * @param {import('./naming.js').NamingStrategy} [options.namingStrategy]
   * @param {import('../fields/registry.js').FieldTypeRegistry} [options.fieldTypeRegistry]
   */
  constructor(options = {}) {
    this.#namingStrategy = options.namingStrategy ?? defaultNamingStrategy;
    this.#fieldTypeRegistry = options.fieldTypeRegistry ?? defaultFieldTypeRegistry;
  }

  /**
   * Defines a model - or extends one, or defines an abstract mixin - in
   * one step, using this registry's naming strategy and field types.
   *
   * @param {Parameters<typeof defineModel>[0] & { extend?: string, mixins?: string[], abstract?: boolean }} options
   * @param {{ origin?: string }} [meta] - who is contributing this (a module/package name),
   *   used in error messages and recorded in the descriptor's `origins`
   * @returns {import('./define-model.js').ModelDescriptor|null} the model's descriptor, or
   *   null when the definition is abstract or is waiting on a definition that doesn't exist yet
   */
  define(options, meta = {}) {
    const { kind, name } = classifyDefinition(options);
    const layer = { kind, def: options, origin: meta.origin ?? null };

    if (kind !== "extension") {
      if (this.#specs.has(name) || this.#pending.some((p) => p.layer.kind !== "extension" && p.layer.def.name === name)) {
        throw new ModelConflictError(`Model "${name}" is already registered`);
      }
    }

    if (this.#missingFor(layer).length > 0) {
      this.#pending.push({ layer });
      return null;
    }
    this.#apply(layer);
    this.#drainPending();
    return this.#models.get(name) ?? null;
  }

  /**
   * Registers an already-built model descriptor (e.g. from
   * defineModel() called directly). Throws if the model name or its
   * resolved table name is already taken. The descriptor is kept as
   * given; it can still be extended or mixed in by later definitions.
   *
   * @param {import('./define-model.js').ModelDescriptor} model
   */
  register(model) {
    if (this.#specs.has(model.name)) {
      throw new ModelConflictError(`Model "${model.name}" is already registered`);
    }
    this.#checkTable(model.name, model.tableName);

    const def = {
      name: model.name,
      table: model.tableName,
      primaryKey: model.primaryKey ?? undefined,
      fields: { ...model.fields, ...(model.computed ?? {}) },
      relations: { ...model.relations },
    };
    this.#specs.set(model.name, { abstract: false, layers: [{ kind: "primary", def, origin: null }] });
    this.#models.set(model.name, model);
    this.#tableOwners.set(model.tableName, model.name);
    this.#drainPending();
    return this;
  }

  /**
   * @param {string} name
   * @returns {import('./define-model.js').ModelDescriptor}
   */
  getModel(name) {
    const model = this.#models.get(name);
    if (model) return model;

    if (this.#specs.get(name)?.abstract) {
      throw new UnknownModelError(
        `Model "${name}" is abstract (a mixin): it has no table and can't be used directly. ` +
          `List it in another model's \`mixins\` instead.`
      );
    }
    const waiting = this.#pending.find((p) => p.layer.kind !== "extension" && p.layer.def.name === name);
    if (waiting) {
      throw new UnknownModelError(
        `Model "${name}" is defined but not usable yet: it is waiting for ${this.#missingFor(waiting.layer).map((n) => `"${n}"`).join(", ")}.`
      );
    }
    throw new UnknownModelError(
      `Unknown model "${name}". Registered models: ${this.listModels().join(", ") || "(none)"}`
    );
  }

  /**
   * @param {string} name
   * @returns {Record<string, import('../fields/define-field.js').FieldDescriptor>}
   */
  getFields(name) {
    return this.getModel(name).fields;
  }

  /** True for a concrete (table-backed) model; abstract mixins are not "models" in this sense. */
  hasModel(name) {
    return this.#models.has(name);
  }

  /** Concrete models only: this is what schema sync, migrations, DTO generation and the meta tables iterate. */
  listModels() {
    return [...this.#models.keys()];
  }

  /** @param {string} name */
  isAbstract(name) {
    return this.#specs.get(name)?.abstract === true;
  }

  listAbstract() {
    return [...this.#specs].filter(([, spec]) => spec.abstract).map(([name]) => name);
  }

  /**
   * Every mixin `name` uses, transitively (a mixin that itself uses
   * mixins counts too), deepest mixin first. Used by `createModel()`'s
   * hook-pulling: hooks a mixin carries (see `defineMixin()`) are
   * applied to a model in this order, before the model's own hooks.
   *
   * @param {string} name
   * @returns {string[]}
   */
  mixinsOf(name) {
    return collectMixinNames(name, this.#specs);
  }

  /**
   * Every CONCRETE model currently using `name` as a mixin, directly or
   * through another mixin. (Compare `mixinsOf()`, which goes the other
   * direction: what a model uses, not who uses it.)
   *
   * @param {string} name
   * @returns {string[]}
   */
  modelsUsingMixin(name) {
    return dependentsOf(name, this.#specs).filter((candidate) => this.#models.has(candidate));
  }

  /**
   * Throws if any definition is still waiting on something that was
   * never defined (or that is part of a mixin cycle). Call once every
   * package has registered its models.
   *
   * @throws {InvalidModelDefinitionError}
   */
  assertResolved() {
    if (this.#pending.length === 0) return;
    const lines = this.#pending.map(({ layer }) => {
      const missing = this.#missingFor(layer).map((n) => `"${n}"`).join(", ");
      return `  - ${this.#describe(layer)} needs ${missing}, which ${this.#missingFor(layer).length > 1 ? "are" : "is"} never defined (or is part of a cycle)`;
    });
    throw new InvalidModelDefinitionError(`Model definitions that can never be applied:\n${lines.join("\n")}`);
  }

  // ---- internals -----------------------------------------------------

  #missingFor(layer) {
    return requirementsOf(layer).filter((name) => !this.#specs.has(name));
  }

  #describe(layer) {
    const what = layer.kind === "extension" ? `Extension of "${layer.def.extend}"` : `Model "${layer.def.name}"`;
    return layer.origin ? `${what} (from module "${layer.origin}")` : what;
  }

  #checkTable(modelName, tableName) {
    if (tableName.startsWith(META_TABLE_PREFIX)) {
      throw new ModelConflictError(
        `Model "${modelName}" resolves to table "${tableName}", which starts with ` +
          `the reserved prefix "${META_TABLE_PREFIX}" used for internal metadata tables. ` +
          `Choose a different table name.`
      );
    }
    if (this.#tableOwners.has(tableName)) {
      throw new ModelConflictError(
        `Model "${modelName}" resolves to table "${tableName}", ` +
          `which is already used by model "${this.#tableOwners.get(tableName)}". Set an explicit \`table\` option on one of them.`
      );
    }
  }

  /** Applies one layer whose requirements are all met, all-or-nothing. */
  #apply(layer) {
    const target = layer.kind === "extension" ? layer.def.extend : layer.def.name;
    const candidate = new Map(this.#specs);
    const previous = this.#specs.get(target);
    candidate.set(
      target,
      layer.kind === "extension"
        ? { abstract: previous.abstract, layers: [...previous.layers, layer] }
        : { abstract: layer.kind === "abstract", layers: [layer] }
    );

    // The target and everything that mixes it in must rebuild, and all must validate.
    const rebuilt = new Map();
    for (const name of [target, ...dependentsOf(target, candidate)]) {
      const spec = candidate.get(name);
      let folded;
      try {
        folded = foldModel(name, candidate);
        const descriptor = defineModel(
          { name, table: spec.abstract ? undefined : folded.table, primaryKey: folded.primaryKey, fields: folded.fields, relations: folded.relations },
          this.#namingStrategy,
          this.#fieldTypeRegistry
        );
        rebuilt.set(name, spec.abstract ? null : Object.freeze({ ...descriptor, origins: Object.freeze({ ...folded.origins }) }));
      } catch (error) {
        const reason =
          name === target ? error.message : `Model "${name}" (which mixes in "${target}") would no longer be valid: ${error.message}`;
        throw error instanceof ModelConflictError ? error : new InvalidModelDefinitionError(reason);
      }
    }

    if (layer.kind === "primary") {
      this.#checkTable(target, rebuilt.get(target).tableName);
    }

    this.#specs = candidate;
    for (const [name, descriptor] of rebuilt) {
      if (descriptor) this.#models.set(name, descriptor);
    }
    if (layer.kind === "primary") this.#tableOwners.set(rebuilt.get(target).tableName, target);
  }

  /** Applies waiting layers whose dependencies now exist, until no more can be. */
  #drainPending() {
    for (;;) {
      const index = this.#pending.findIndex((entry) => this.#missingFor(entry.layer).length === 0);
      if (index === -1) return;
      const [{ layer }] = this.#pending.splice(index, 1);
      try {
        this.#apply(layer);
      } catch (error) {
        throw new (error.constructor)(`${this.#describe(layer)} could not be applied once its dependencies arrived: ${error.message}`);
      }
    }
  }
}
