import { RelationError } from "./errors.js";
import { resolveLocalKey } from "./keys.js";
import { chunkArray, rowsPerStatement } from "../crud/insert-many.js";

function resolveId(source, localKey) {
  return typeof source === "object" && source !== null ? source[localKey] : source;
}

// belongsToMany's localKey is a field on the model that owns the relation.
function localKeyOf(relation, model) {
  return resolveLocalKey(relation, model);
}

function requireSourceId(sourceId, relationName, modelName, localKey) {
  if (sourceId === undefined || sourceId === null) {
    throw new RelationError(
      `Cannot attach via "${relationName}" on model "${modelName}": the source has no value for its "${localKey}" field`
    );
  }
  return sourceId;
}

function requireBelongsToMany(model, modelName, relationName) {
  const relation = model.relations?.[relationName];
  if (!relation) {
    throw new RelationError(`Unknown relation "${relationName}" on model "${modelName}"`);
  }
  if (relation.type !== "belongsToMany") {
    throw new RelationError(
      `attach()/detach() require a belongsToMany relation, but "${relationName}" on model "${modelName}" is "${relation.type}"`
    );
  }
  return relation;
}

// Compared as strings so 5 and "5" are the same association. Values
// are only ever *compared* this way; what gets inserted is untouched.
function pairKey(sourceId, targetId) {
  return `${sourceId}\u0001${targetId}`;
}

/** Above this many distinct target ids, the existence check stops narrowing by target (see loadExistingPairs). */
const MAX_TARGET_FILTER = 500;
const SOURCE_CHUNK = 500;

/**
 * Which of `pairs` already exist in the pivot table. Queries by source
 * id, in chunks, so the cost is one SELECT per few hundred sources
 * rather than one per source.
 *
 * Narrowing by target as well is a cheap win when there are few
 * distinct targets (the typical `attach(post, "tags", [1, 2])`), but
 * with thousands of distinct targets it would just bloat the
 * statement, so past MAX_TARGET_FILTER we filter client-side only.
 */
async function loadExistingPairs(db, relation, pairs) {
  const sources = [...new Set(pairs.map(([source]) => source))];
  const targets = [...new Set(pairs.map(([, target]) => target))];
  const narrowByTarget = targets.length <= MAX_TARGET_FILTER;

  const existing = new Set();
  for (const sourceChunk of chunkArray(sources, SOURCE_CHUNK)) {
    let query = db(relation.through).select(relation.foreignKey, relation.otherKey).whereIn(relation.foreignKey, sourceChunk);
    if (narrowByTarget) query = query.whereIn(relation.otherKey, targets);
    for (const row of await query) {
      existing.add(pairKey(row[relation.foreignKey], row[relation.otherKey]));
    }
  }
  return existing;
}

/**
 * The batched core behind attach(), attachMany(), and relation
 * payloads on create. Associates any number of (source, target) pairs
 * through a `belongsToMany` relation's pivot table using a constant
 * number of statements: at most one existence check per few hundred
 * sources, plus one INSERT per chunk of rows - never one per pair.
 *
 * Duplicate pairs within `pairs`, and pairs that already exist, are
 * skipped rather than erroring.
 *
 * @param {import('knex').Knex} db - connection or transaction
 * @param {import('./define-relation.js').RelationDescriptor} relation - a belongsToMany relation
 * @param {Array<[number|string, number|string]>} pairs - `[sourceId, targetId]`
 * @param {Object} [options]
 * @param {boolean} [options.checkExisting] - default true. Pass false only when the
 *   sources were created in this same operation (so no association can exist yet),
 *   which skips the existence check entirely; a genuine duplicate then surfaces as
 *   the pivot table's own unique-constraint error instead of being silently skipped.
 * @param {number} [options.chunkSize]
 * @returns {Promise<number>} count of associations actually inserted
 */
export async function attachPairs(db, relation, pairs, options = {}) {
  const seen = new Set();
  const unique = [];
  for (const pair of pairs) {
    const key = pairKey(pair[0], pair[1]);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(pair);
    }
  }
  if (unique.length === 0) return 0;

  let toInsert = unique;
  if (options.checkExisting !== false) {
    const existing = await loadExistingPairs(db, relation, unique);
    toInsert = unique.filter(([source, target]) => !existing.has(pairKey(source, target)));
  }
  if (toInsert.length === 0) return 0;

  const rows = toInsert.map(([source, target]) => ({
    [relation.foreignKey]: source,
    [relation.otherKey]: target,
  }));
  for (const chunk of chunkArray(rows, rowsPerStatement(db, 2, options.chunkSize))) {
    await db(relation.through).insert(chunk);
  }
  return rows.length;
}

/**
 * Associates one or more related records via a `belongsToMany`
 * relation's pivot table. Existing associations are left alone (not
 * duplicated) rather than erroring on a repeat attach() of the same
 * pair.
 *
 * For many sources at once use attachManyRelation() - calling this in
 * a loop costs a couple of queries per source.
 *
 * @param {import('knex').Knex} db
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {string} modelName
 * @param {Record<string, unknown>|number|string} source - an entity or a raw id
 * @param {string} relationName
 * @param {number|string|Array<number|string>} targetIds
 * @returns {Promise<number>} count of new associations actually inserted
 */
export async function attachRelation(db, model, modelName, source, relationName, targetIds) {
  const relation = requireBelongsToMany(model, modelName, relationName);
  const ids = Array.isArray(targetIds) ? targetIds : [targetIds];
  if (ids.length === 0) return 0;

  const sourceId = requireSourceId(resolveId(source, localKeyOf(relation, model)), relationName, modelName, localKeyOf(relation, model));
  return attachPairs(
    db,
    relation,
    ids.map((id) => [sourceId, id])
  );
}

/**
 * Bulk version of attachRelation(): associates many sources with
 * their targets in one go. Cost is independent of how many sources
 * there are - a handful of statements for thousands of associations
 * - which is what makes it the right tool for importing pivot data.
 *
 * @param {import('knex').Knex} db
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {string} modelName
 * @param {string} relationName
 * @param {Array<{ source: Record<string, unknown>|number|string, targets: number|string|Array<number|string> }>} links
 * @param {{ chunkSize?: number }} [options]
 * @returns {Promise<number>} count of new associations actually inserted
 */
export async function attachManyRelation(db, model, modelName, relationName, links, options = {}) {
  const relation = requireBelongsToMany(model, modelName, relationName);
  if (!Array.isArray(links)) {
    throw new TypeError("attachMany() expects an array of { source, targets } entries");
  }

  const pairs = [];
  links.forEach((link, index) => {
    if (link === null || typeof link !== "object" || !("source" in link) || !("targets" in link)) {
      throw new TypeError(`attachMany() entry [${index}] must be an object with \`source\` and \`targets\``);
    }
    const targets = Array.isArray(link.targets) ? link.targets : [link.targets];
    if (targets.length === 0) return;
    const sourceId = requireSourceId(resolveId(link.source, localKeyOf(relation, model)), relationName, modelName, localKeyOf(relation, model));
    for (const target of targets) pairs.push([sourceId, target]);
  });

  return attachPairs(db, relation, pairs, { chunkSize: options.chunkSize });
}

/**
 * Removes one or more associations via a `belongsToMany` relation's
 * pivot table.
 *
 * @param {import('knex').Knex} db
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {string} modelName
 * @param {Record<string, unknown>|number|string} source
 * @param {string} relationName
 * @param {number|string|Array<number|string>} targetIds
 * @returns {Promise<number>} count of associations removed
 */
export async function detachRelation(db, model, modelName, source, relationName, targetIds) {
  const relation = requireBelongsToMany(model, modelName, relationName);
  const sourceId = resolveId(source, localKeyOf(relation, model));
  const ids = Array.isArray(targetIds) ? targetIds : [targetIds];
  if (ids.length === 0) return 0;

  return db(relation.through).where(relation.foreignKey, sourceId).whereIn(relation.otherKey, ids).delete();
}
