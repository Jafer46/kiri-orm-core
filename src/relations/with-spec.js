import { RelationError } from "./errors.js";
import { normalizeSelect } from "../crud/select.js";
import { normalizeOrderBy, validatePaging } from "../crud/order.js";
import { resolveWhere } from "../crud/resolve-where.js";
import { ValidationError } from "../crud/errors.js";
import { defaultFieldTypeRegistry } from "../fields/default-registry.js";
import { resolveLocalKey } from "./keys.js";

/**
 * The `with` option of find()/findOne()/load(), in every shape it can take, normalized
 * into one tree the loader walks.
 *
 *   with: ["author", "comments.user"]                        // names and dotted paths (always worked)
 *   with: { author: true }                                   // same as "author"
 *   with: { author: { select: ["name"] } }                   // narrow the related rows
 *   with: { author: ["name"] }                               // shorthand for { select: [...] }
 *   with: { comments: { select: ["body"], with: { user: { select: ["name"] } } } }
 *   with: { "comments.user": { select: ["name"] } }         // a dotted key: the spec applies to the last one
 *   with: ["author", { comments: { select: ["body"] } }]     // arrays may mix both
 *   with: { author: false }                                  // skipped, handy for conditionals
 *
 * A relation can also be constrained - which related rows to load, in what order, and how many
 * PER PARENT:
 *
 *   with: { comments: { where: [["likes", ">", 2]], orderBy: "-likes", limit: 3 } }   // each post's top 3
 *   with: { tags: { orderBy: "name", limit: 2, offset: 1 } }
 *   with: { pinned: { orderBy: "-likes" } }                  // a hasOne: which row counts as "the" one
 *
 * `where` takes anything find() takes (an object, or a domain array that may cross relations).
 * `orderBy` takes anything find() takes. `limit` and `offset` count within each parent's rows, not
 * across the whole result (see eager-load.js for how that is done in one query). `orderBy`,
 * `limit` and `offset` only make sense for a relation that can have several rows, so a belongsTo
 * rejects all three and a hasOne rejects `limit`/`offset`.
 *
 * The same relation named twice is merged, not loaded twice: `select`s are unioned, `where`s are
 * ANDed, but an explicit `select` beats a bare name (which just means "all fields") - so
 * `["comments.user", { comments: { select: ["body"] } }]` still narrows `comments`. `orderBy`,
 * `limit` and `offset` can't be merged, so naming them twice with different values is an error.
 *
 * @typedef {{ select: string[]|null, with: Map<string, WithNode>, where: unknown,
 *   orderBy: unknown, limit: number|undefined, offset: number|undefined,
 *   whereFn: Function|null, order: Array<{ field: string, direction: "asc"|"desc" }> }} WithNode
 */

const SPEC_KEYS = new Set(["select", "with", "where", "orderBy", "limit", "offset"]);
const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const newNode = () => ({ select: null, with: new Map(), where: undefined, orderBy: undefined, limit: undefined, offset: undefined, whereFn: null, order: [] });

function mergeSelect(a, b) {
  if (a === null || a === undefined) return b ?? null;
  if (b === null || b === undefined) return a;
  return [...new Set([...a, ...b])];
}

/** `where`s are ANDed (each may be an object or a domain array; both become lists of conditions). */
function mergeWhere(a, b) {
  if (a === undefined) return b;
  if (b === undefined) return a;
  const terms = (w) => (Array.isArray(w) ? w : Object.entries(w).map(([field, value]) => [field, "=", value]));
  return [...terms(a), ...terms(b)];
}

/** orderBy / limit / offset: one value or none - two different ones can't be combined. */
function mergeSingle(name, relation, a, b) {
  if (a === undefined) return b;
  if (b === undefined) return a;
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new RelationError(`\`${name}\` is given twice for relation "${relation}" with different values (${JSON.stringify(a)} and ${JSON.stringify(b)})`);
  }
  return a;
}

function mergeInto(tree, name, node) {
  const existing = tree.get(name);
  if (!existing) {
    tree.set(name, node);
    return;
  }
  existing.select = mergeSelect(existing.select, node.select);
  existing.where = mergeWhere(existing.where, node.where);
  for (const key of ["orderBy", "limit", "offset"]) existing[key] = mergeSingle(key, name, existing[key], node[key]);
  for (const [childName, childNode] of node.with) mergeInto(existing.with, childName, childNode);
}

/** Adds `path` ("a.b.c") to `tree`; `leaf` describes the last segment, the ones before it are bare. */
function addPath(tree, path, leaf) {
  const [head, ...rest] = path.split(".");
  if (head === "") throw new RelationError(`Invalid \`with\` path "${path}"`);
  const node = rest.length === 0 ? leaf : newNode();
  if (rest.length > 0) addPath(node.with, rest.join("."), leaf);
  mergeInto(tree, head, node);
}

function parseSpec(name, value) {
  if (value === true) return newNode();
  if (Array.isArray(value)) return { ...newNode(), select: value };
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      if (!SPEC_KEYS.has(key)) {
        throw new RelationError(`Unknown option "${key}" for relation "${name}" in \`with\`. Valid options: ${[...SPEC_KEYS].join(", ")}`);
      }
    }
    return {
      ...newNode(),
      select: value.select ?? null,
      with: parseWith(value.with),
      where: value.where ?? undefined,
      orderBy: value.orderBy ?? undefined,
      limit: value.limit ?? undefined,
      offset: value.offset ?? undefined,
    };
  }
  throw new RelationError(`\`with\` entry for relation "${name}" must be true, an array of fields, or { select, with } - got ${JSON.stringify(value)}`);
}

function parseWith(input) {
  const tree = new Map();
  if (input === undefined || input === null) return tree;
  for (const item of Array.isArray(input) ? input : [input]) {
    if (typeof item === "string") {
      addPath(tree, item, newNode());
    } else if (isPlainObject(item)) {
      for (const [key, value] of Object.entries(item)) {
        if (value === false || value === null || value === undefined) continue;
        addPath(tree, key, parseSpec(key, value));
      }
    } else {
      throw new RelationError(`\`with\` entries must be relation names or objects, got ${JSON.stringify(item)}`);
    }
  }
  return tree;
}

/**
 * Checks every relation exists and every option makes sense for it, before any query runs - and
 * compiles each `where` and `orderBy` against the related model, so a typo in either fails here
 * rather than half way through loading.
 */
function validate(model, modelRegistry, tree, fieldTypeRegistry) {
  for (const [name, node] of tree) {
    const relation = model.relations?.[name];
    if (!relation) throw new RelationError(`Unknown relation "${name}" on model "${model.name}"`);
    const relatedModel = modelRegistry.getModel(relation.model); // throws UnknownModelError if missing
    node.select = normalizeSelect(relatedModel, node.select);

    const where = `relation "${name}" on model "${model.name}"`;
    const toOne = relation.type === "belongsTo";
    const single = toOne || relation.type === "hasOne";
    if (node.orderBy !== undefined && toOne) {
      throw new RelationError(`\`orderBy\` doesn't apply to ${where}: a belongsTo has at most one related row`);
    }
    for (const key of ["limit", "offset"]) {
      if (node[key] !== undefined && single) {
        throw new RelationError(`\`${key}\` doesn't apply to ${where}: a ${relation.type} has at most one related row`);
      }
    }
    if (node.orderBy !== undefined) node.order = normalizeOrderBy(relatedModel, node.orderBy);
    if (node.limit !== undefined || node.offset !== undefined) validatePaging(relatedModel, { limit: node.limit, offset: node.offset });
    if (node.where !== undefined) {
      try {
        node.whereFn = resolveWhere(relatedModel, node.where, fieldTypeRegistry, modelRegistry);
      } catch (error) {
        if (error instanceof ValidationError || error?.name?.startsWith("Domain")) {
          throw new RelationError(`Invalid \`where\` for ${where}: ${error.message}`, { cause: error });
        }
        throw error;
      }
    }
    validate(relatedModel, modelRegistry, node.with, fieldTypeRegistry);
  }
}

/**
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {import('../models/registry.js').ModelRegistry} modelRegistry
 * @param {unknown} input - any accepted shape of `with`
 * @param {import('../fields/registry.js').FieldTypeRegistry} [fieldTypeRegistry] - for compiling `where`
 * @returns {Map<string, WithNode>} empty when nothing is to be loaded
 * @throws {RelationError} unknown relation or option, malformed entry
 * @throws {import('../crud/errors.js').ValidationError} a `select` naming a field that doesn't exist
 */
export function normalizeWith(model, modelRegistry, input, fieldTypeRegistry = defaultFieldTypeRegistry) {
  const tree = parseWith(input);
  validate(model, modelRegistry, tree, fieldTypeRegistry);
  return tree;
}

/**
 * The fields of `model` that must be read for the relations in `tree` to be matched to it:
 * a belongsTo reads the foreign key, everything else reads the local key.
 *
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {import('../models/registry.js').ModelRegistry} modelRegistry
 * @param {Map<string, WithNode>} tree
 * @returns {string[]}
 */
export function parentKeysNeeded(model, modelRegistry, tree) {
  const keys = [];
  for (const name of tree.keys()) {
    const relation = model.relations[name];
    const relatedModel = modelRegistry.getModel(relation.model);
    keys.push(relation.type === "belongsTo" ? relation.foreignKey : resolveLocalKey(relation, model, relatedModel));
  }
  return [...new Set(keys)];
}
