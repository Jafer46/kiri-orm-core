import { defineModel } from "./define-model.js";
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
export declare class ModelRegistry {
    #private;
    /**
     * @param {Object} [options]
     * @param {import('./naming.js').NamingStrategy} [options.namingStrategy]
     * @param {import('../fields/registry.js').FieldTypeRegistry} [options.fieldTypeRegistry]
     */
    constructor(options?: {
        namingStrategy?: import('./naming.js').NamingStrategy;
        fieldTypeRegistry?: import('../fields/registry.js').FieldTypeRegistry;
    });
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
    define(options: Parameters<typeof defineModel>[0] & {
        extend?: string;
        mixins?: string[];
        abstract?: boolean;
    }, meta?: {
        origin?: string;
    }): import('./define-model.js').ModelDescriptor | null;
    /**
     * Registers an already-built model descriptor (e.g. from
     * defineModel() called directly). Throws if the model name or its
     * resolved table name is already taken. The descriptor is kept as
     * given; it can still be extended or mixed in by later definitions.
     *
     * @param {import('./define-model.js').ModelDescriptor} model
     */
    register(model: import('./define-model.js').ModelDescriptor): this;
    /**
     * @param {string} name
     * @returns {import('./define-model.js').ModelDescriptor}
     */
    getModel(name: string): import('./define-model.js').ModelDescriptor;
    /**
     * @param {string} name
     * @returns {Record<string, import('../fields/define-field.js').FieldDescriptor>}
     */
    getFields(name: string): Record<string, import('../fields/define-field.js').FieldDescriptor>;
    /** True for a concrete (table-backed) model; abstract mixins are not "models" in this sense. */
    hasModel(name: any): boolean;
    /** Concrete models only: this is what schema sync, migrations, DTO generation and the meta tables iterate. */
    listModels(): any[];
    /** @param {string} name */
    isAbstract(name: string): boolean;
    listAbstract(): any[];
    /**
     * Every mixin `name` uses, transitively (a mixin that itself uses
     * mixins counts too), deepest mixin first. Used by `createModel()`'s
     * hook-pulling: hooks a mixin carries (see `defineMixin()`) are
     * applied to a model in this order, before the model's own hooks.
     *
     * @param {string} name
     * @returns {string[]}
     */
    mixinsOf(name: string): string[];
    /**
     * Every CONCRETE model currently using `name` as a mixin, directly or
     * through another mixin. (Compare `mixinsOf()`, which goes the other
     * direction: what a model uses, not who uses it.)
     *
     * @param {string} name
     * @returns {string[]}
     */
    modelsUsingMixin(name: string): string[];
    /**
     * Throws if any definition is still waiting on something that was
     * never defined (or that is part of a mixin cycle). Call once every
     * package has registered its models.
     *
     * @throws {InvalidModelDefinitionError}
     */
    assertResolved(): void;
}
