import { META_MODELS_TABLE, META_FIELDS_TABLE } from "./reserved-tables.js";

/**
 * Returns the `_meta_models` row for a model, or undefined if it's
 * never been synced. Excludes models flagged as removed unless
 * `includeRemoved` is set.
 *
 * @param {import('knex').Knex} db
 * @param {string} modelName
 * @param {{ includeRemoved?: boolean }} [options]
 */
export async function getModelMeta(db, modelName, options = {}) {
  const query = db(META_MODELS_TABLE).where({ name: modelName });
  if (!options.includeRemoved) query.whereNull("removed_at");
  return query.first();
}

/**
 * Returns the `_meta_fields` rows for a model, ordered by field name.
 * This is the plain-SQL-queryable answer to "what fields does model X
 * have, and what are their types" that Phase 4 exists to provide.
 *
 * @param {import('knex').Knex} db
 * @param {string} modelName
 * @param {{ includeRemoved?: boolean }} [options]
 */
export async function getFieldsMeta(db, modelName, options = {}) {
  const query = db(META_FIELDS_TABLE).where({ model: modelName }).orderBy("name");
  if (!options.includeRemoved) query.whereNull("removed_at");
  return query;
}

/**
 * Returns all `_meta_models` rows, ordered by name. Excludes models
 * flagged as removed unless `includeRemoved` is set.
 *
 * @param {import('knex').Knex} db
 * @param {{ includeRemoved?: boolean }} [options]
 */
export async function listModelsMeta(db, options = {}) {
  const query = db(META_MODELS_TABLE).orderBy("name");
  if (!options.includeRemoved) query.whereNull("removed_at");
  return query;
}
