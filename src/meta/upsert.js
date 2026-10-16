import { META_MODELS_TABLE, META_FIELDS_TABLE } from "./reserved-tables.js";

/**
 * Inserts or updates a `_meta_models` row for the given model
 * descriptor, and returns its id. Clears `removed_at` if the model
 * was previously flagged as removed and has now reappeared.
 *
 * Uses select-then-insert-or-update rather than an upsert/onConflict
 * clause: `.onConflict().merge()` support varies enough across Knex's
 * sqlite and postgres dialects that the extra round trip here is a
 * worthwhile trade for staying dialect-portable without surprises.
 *
 * @param {import('knex').Knex} trx
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {Date} now
 * @returns {Promise<number>}
 */
export async function ensureMetaModel(trx, model, now) {
  const existing = await trx(META_MODELS_TABLE).where({ name: model.name }).first();

  if (existing) {
    await trx(META_MODELS_TABLE).where({ id: existing.id }).update({
      table_name: model.tableName,
      updated_at: now,
      removed_at: null,
    });
    return existing.id;
  }

  await trx(META_MODELS_TABLE).insert({
    name: model.name,
    table_name: model.tableName,
    created_at: now,
    updated_at: now,
    removed_at: null,
  });
  const created = await trx(META_MODELS_TABLE).where({ name: model.name }).first();
  return created.id;
}

/**
 * Inserts or updates a `_meta_fields` row for one field on a model.
 * The full field descriptor is stored as JSON in `options` for
 * fidelity (factory-function defaults are silently dropped by
 * JSON.stringify, consistent with Phase 3's schema-sync treatment of
 * them as a JS-side, not a persisted, concern).
 *
 * @param {import('knex').Knex} trx
 * @param {number} modelId
 * @param {string} modelName
 * @param {string} fieldName
 * @param {import('../fields/define-field.js').FieldDescriptor} field
 * @param {string} columnName
 * @param {Date} now
 */
export async function ensureMetaField(trx, modelId, modelName, fieldName, field, columnName, now) {
  const existing = await trx(META_FIELDS_TABLE)
    .where({ model_id: modelId, name: fieldName })
    .first();

  const shared = {
    model_id: modelId,
    model: modelName,
    name: fieldName,
    column: columnName,
    type: field.type,
    required: Boolean(field.required),
    is_unique: Boolean(field.unique),
    is_indexed: Boolean(field.index),
    options: JSON.stringify(field),
    updated_at: now,
    removed_at: null,
  };

  if (existing) {
    await trx(META_FIELDS_TABLE).where({ id: existing.id }).update(shared);
  } else {
    await trx(META_FIELDS_TABLE).insert({ ...shared, created_at: now });
  }
}

/**
 * Inserts or updates a `_meta_fields` row for one relation on a model
 * (Phase 7). Relations share the `_meta_fields` table with scalar
 * fields rather than getting a table of their own - the roadmap calls
 * for exactly this ("Relation fields stored in _meta_fields too"),
 * and it's a natural fit since `options` already exists as a flexible
 * JSON column for full-fidelity storage regardless of shape.
 *
 * `column` is set to the underlying foreign-key column when this
 * model owns it (belongsTo), or left as an empty string for
 * hasOne/hasMany/belongsToMany, which don't have a column of their
 * own on this model. `required`/`is_unique`/`is_indexed` don't apply
 * to relations and are always stored as false; the full descriptor
 * (type, model, foreignKey, through, otherKey, localKey) lives in
 * `options` for introspection.
 *
 * @param {import('knex').Knex} trx
 * @param {number} modelId
 * @param {string} modelName
 * @param {string} relationName
 * @param {import('../relations/define-relation.js').RelationDescriptor} relation
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {Date} now
 */
export async function ensureMetaRelation(trx, modelId, modelName, relationName, relation, model, now) {
  const existing = await trx(META_FIELDS_TABLE)
    .where({ model_id: modelId, name: relationName })
    .first();

  const columnName = relation.type === "belongsTo" ? model.columns[relation.foreignKey] ?? "" : "";

  const shared = {
    model_id: modelId,
    model: modelName,
    name: relationName,
    column: columnName,
    type: relation.type,
    required: false,
    is_unique: false,
    is_indexed: false,
    options: JSON.stringify(relation),
    updated_at: now,
    removed_at: null,
  };

  if (existing) {
    await trx(META_FIELDS_TABLE).where({ id: existing.id }).update(shared);
  } else {
    await trx(META_FIELDS_TABLE).insert({ ...shared, created_at: now });
  }
}

/**
 * Flags `_meta_models` rows as removed (sets `removed_at`) when their
 * name is no longer present in the current registry. Never deletes -
 * metadata history is preserved so a later phase (migrations) can
 * still see what used to exist.
 *
 * @param {import('knex').Knex} trx
 * @param {import('../models/registry.js').ModelRegistry} modelRegistry
 * @param {Date} now
 * @returns {Promise<string[]>} names of models newly flagged as removed
 */
export async function flagRemovedModels(trx, modelRegistry, now) {
  const currentNames = new Set(modelRegistry.listModels());
  const rows = await trx(META_MODELS_TABLE).whereNull("removed_at");

  const removed = [];
  for (const row of rows) {
    if (!currentNames.has(row.name)) {
      await trx(META_MODELS_TABLE).where({ id: row.id }).update({ removed_at: now });
      removed.push(row.name);
    }
  }
  return removed;
}

/**
 * Flags `_meta_fields` rows as removed for one model when their field
 * name is no longer present on that model's current field set. Never
 * deletes, same rationale as flagRemovedModels().
 *
 * @param {import('knex').Knex} trx
 * @param {number} modelId
 * @param {Set<string>} currentFieldNames
 * @param {Date} now
 * @returns {Promise<string[]>} field names newly flagged as removed
 */
export async function flagRemovedFields(trx, modelId, currentFieldNames, now) {
  const rows = await trx(META_FIELDS_TABLE)
    .where({ model_id: modelId })
    .whereNull("removed_at");

  const removed = [];
  for (const row of rows) {
    if (!currentFieldNames.has(row.name)) {
      await trx(META_FIELDS_TABLE).where({ id: row.id }).update({ removed_at: now });
      removed.push(row.name);
    }
  }
  return removed;
}
