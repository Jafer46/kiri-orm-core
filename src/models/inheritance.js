import { InvalidModelDefinitionError } from "./errors.js";

/**
 * Model inheritance, in the shape of Odoo's `_inherit` - which Odoo
 * uses for two different things, so here they are two explicit forms:
 *
 *   // 1. EXTEND an existing model in place (Odoo: `_inherit = 'x'`, no `_name`).
 *   //    Same model, same table; typically written by ANOTHER package.
 *   { extend: "post", fields: { seoTitle: { type: "char" } } }
 *
 *   // 2. Compose a NEW model from mixins (Odoo: `_name` + `_inherit = [..]`).
 *   //    Mixins are `abstract: true` models: fields only, no table of their own.
 *   { name: "timestamped", abstract: true, fields: { createdAt: { type: "datetime" } } }
 *   { name: "invoice", mixins: ["timestamped"], fields: { id: { type: "integer" } } }
 *
 * A model is a stack of LAYERS: its own definition, then each
 * extension, in the order they were registered. Folding the stack
 * produces the definition defineModel() finally validates. Within one
 * layer the mixins apply first and the layer's own fields after, so a
 * model can always override what it mixes in; a later layer overrides
 * an earlier one.
 *
 * Overriding merges attribute by attribute (`{ required: true }` on an
 * existing field keeps its type, length, and everything else). What an
 * override may NOT do is change the field's kind of storage or type:
 * turning a stored field into a computed one (or back), or changing
 * its `type`, would silently change a column, so it is an error.
 */

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Checks the shape of a raw definition and says what kind of layer it is.
 *
 * @param {unknown} def
 * @returns {{ kind: "primary"|"abstract"|"extension", name: string }} `name` is the model the layer belongs to
 */
export function classifyDefinition(def) {
  if (!def || typeof def !== "object") {
    throw new InvalidModelDefinitionError("Model definition must be an object");
  }

  if (def.mixins !== undefined) {
    if (!Array.isArray(def.mixins) || def.mixins.some((m) => typeof m !== "string" || !m.trim())) {
      throw new InvalidModelDefinitionError("`mixins` must be an array of model names");
    }
    if (new Set(def.mixins).size !== def.mixins.length) {
      throw new InvalidModelDefinitionError(`\`mixins\` lists the same model more than once: ${def.mixins.join(", ")}`);
    }
  }

  if (def.extend !== undefined) {
    if (typeof def.extend !== "string" || !def.extend.trim()) {
      throw new InvalidModelDefinitionError("`extend` must be the name of the model to extend");
    }
    for (const key of ["name", "table", "abstract"]) {
      if (def[key] !== undefined) {
        throw new InvalidModelDefinitionError(
          `An extension of "${def.extend}" can't set \`${key}\`: it names the model it extends with \`extend\` and shares that model's ${key === "table" ? "table" : "identity"}`
        );
      }
    }
    if (def.mixins?.includes(def.extend)) {
      throw new InvalidModelDefinitionError(`Model "${def.extend}" can't mix in itself`);
    }
    return { kind: "extension", name: def.extend };
  }

  if (typeof def.name !== "string" || !def.name.trim()) {
    throw new InvalidModelDefinitionError("Model definition requires a non-empty `name`");
  }
  if (def.mixins?.includes(def.name)) {
    throw new InvalidModelDefinitionError(`Model "${def.name}" can't mix in itself`);
  }
  if (def.abstract !== undefined && typeof def.abstract !== "boolean") {
    throw new InvalidModelDefinitionError(`Model "${def.name}" \`abstract\` must be a boolean`);
  }
  if (def.abstract && def.table !== undefined) {
    throw new InvalidModelDefinitionError(`Model "${def.name}" is abstract, so it has no table: remove \`table\``);
  }
  return { kind: def.abstract ? "abstract" : "primary", name: def.name };
}

/** How a layer is named in error messages and in `origins`. */
export function layerLabel(layer) {
  if (layer.origin) return `module "${layer.origin}"`;
  return layer.kind === "extension" ? "an extension" : "the model definition";
}

/** Names that must already be defined before this layer can be applied. */
export function requirementsOf(layer) {
  const needs = [];
  if (layer.kind === "extension") needs.push(layer.def.extend);
  for (const mixin of layer.def.mixins ?? []) needs.push(mixin);
  return needs;
}

function mergeAttributes(kind, modelName, itemName, existing, incoming, label) {
  if (!isPlainObject(incoming)) {
    throw new InvalidModelDefinitionError(`Model "${modelName}", ${kind} "${itemName}" (from ${label}) must be an object`);
  }
  if (incoming.type !== undefined && incoming.type !== existing.type) {
    throw new InvalidModelDefinitionError(
      `Model "${modelName}", ${kind} "${itemName}": ${label} changes its type from "${existing.type}" to "${incoming.type}". ` +
        `An override can change a ${kind}'s options but not its type.`
    );
  }
  if (kind === "field" && (existing.compute === undefined) !== (incoming.compute === undefined) && incoming.compute !== undefined) {
    throw new InvalidModelDefinitionError(
      `Model "${modelName}", field "${itemName}": ${label} turns a stored field into a computed one, which would drop its column. ` +
        `Use a new field name instead.`
    );
  }
  return { ...existing, ...incoming };
}

function applyPart(state, modelName, fields, relations, label) {
  for (const [name, options] of Object.entries(fields)) {
    if (has(state.fields, name)) {
      state.fields[name] = mergeAttributes("field", modelName, name, state.fields[name], options, label);
    } else {
      if (!isPlainObject(options)) {
        throw new InvalidModelDefinitionError(`Model "${modelName}", field "${name}" (from ${label}) must be an object`);
      }
      state.fields[name] = { ...options };
      state.origins[name] = label;
    }
  }
  for (const [name, options] of Object.entries(relations)) {
    if (has(state.relations, name)) {
      state.relations[name] = mergeAttributes("relation", modelName, name, state.relations[name], options, label);
    } else {
      if (!isPlainObject(options)) {
        throw new InvalidModelDefinitionError(`Model "${modelName}", relation "${name}" (from ${label}) must be an object`);
      }
      state.relations[name] = { ...options };
      state.origins[name] = label;
    }
  }
}

/**
 * Folds a model's layers (mixins expanded, in order) into the single
 * definition defineModel() will validate. Reads everything fresh from
 * `specs` every time - nothing is cached - so a change to a mixin is
 * always seen by the models that use it.
 *
 * @param {string} name
 * @param {Map<string, { abstract: boolean, layers: Array<{ kind: string, def: object, origin?: string|null }> }>} specs
 * @param {string[]} [stack] - models currently being folded, to catch mixin cycles
 * @returns {{ table: string|undefined, primaryKey: string|undefined, fields: Record<string, object>, relations: Record<string, object>, origins: Record<string, string> }}
 */
export function foldModel(name, specs, stack = []) {
  if (stack.includes(name)) {
    throw new InvalidModelDefinitionError(`Circular mixins: ${[...stack, name].join(" -> ")}`);
  }
  const state = { table: undefined, primaryKey: undefined, fields: {}, relations: {}, origins: {} };

  for (const layer of specs.get(name).layers) {
    for (const mixinName of layer.def.mixins ?? []) {
      // A mixin contributes its fields and relations - never its name or table.
      const mixin = foldModel(mixinName, specs, [...stack, name]);
      applyPart(state, name, mixin.fields, mixin.relations, `mixin "${mixinName}"`);
      // A mixin may declare the primary key its models get; one set on the model itself wins.
      if (mixin.primaryKey !== undefined) state.primaryKey = mixin.primaryKey;
    }
    if (layer.def.primaryKey !== undefined) state.primaryKey = layer.def.primaryKey;
    if (layer.def.table !== undefined) {
      if (state.table !== undefined && state.table !== layer.def.table) {
        throw new InvalidModelDefinitionError(
          `Model "${name}": ${layerLabel(layer)} sets table "${layer.def.table}" but it is already "${state.table}"`
        );
      }
      state.table = layer.def.table;
    }
    applyPart(state, name, layer.def.fields ?? {}, layer.def.relations ?? {}, layerLabel(layer));
  }
  return state;
}

/**
 * Every mixin used by `name`'s layers, transitively (a mixin using
 * another mixin counts too). Used to decide which mixins' hooks a
 * concrete model should pick up when it's created - see
 * `global/create-model.js`'s `createModel()`.
 *
 * @param {string} name
 * @param {Map<string, { abstract: boolean, layers: Array<{ kind: string, def: object }> }>} specs
 * @returns {string[]} deepest mixins first - a mixin's own mixins resolve
 *   before the mixin that includes them, matching how `foldModel()` folds
 *   their fields (so the same ordering intuition applies to both)
 */
export function collectMixinNames(name, specs, seen = new Set()) {
  const spec = specs.get(name);
  if (!spec) return [];
  const found = [];
  for (const layer of spec.layers) {
    for (const mixinName of layer.def.mixins ?? []) {
      if (seen.has(mixinName)) continue;
      seen.add(mixinName);
      found.push(...collectMixinNames(mixinName, specs, seen)); // a mixin's own mixins resolve first
      found.push(mixinName);
    }
  }
  return found;
}

/**
 * Names of every model that mixes in `name`, directly or through
 * another mixin, according to `specs`.
 *
 * @param {string} name
 * @param {Map<string, { abstract: boolean, layers: Array<{ kind: string, def: object }> }>} specs
 * @returns {string[]}
 */
export function dependentsOf(name, specs) {
  const found = new Set();
  const queue = [name];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const [candidate, spec] of specs) {
      if (found.has(candidate)) continue;
      if (spec.layers.some((layer) => layer.def.mixins?.includes(current))) {
        found.add(candidate);
        queue.push(candidate);
      }
    }
  }
  return [...found];
}
