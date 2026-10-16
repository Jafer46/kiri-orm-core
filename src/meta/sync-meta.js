import {
  ensureMetaModel,
  ensureMetaField,
  ensureMetaRelation,
  flagRemovedModels,
  flagRemovedFields,
} from "./upsert.js";

/**
 * @typedef {Object} MetaSyncResult
 * @property {string[]} modelsUpserted
 * @property {string[]} fieldsUpserted - "modelName.fieldName"
 * @property {string[]} modelsRemoved - flagged, not deleted
 * @property {string[]} fieldsRemoved - "modelName.fieldName", flagged not deleted
 */

/**
 * Upserts `_meta_models`/`_meta_fields` rows to reflect the current
 * state of `modelRegistry`. Called by schema.sync() after the real
 * data tables have been created/altered, so the metadata always
 * describes what's actually in the database.
 *
 * Assumes ensureMetaTables() has already been run - deliberately not
 * called from here, since that's a DDL operation kept outside the
 * DML transaction this function runs in.
 *
 * A model or field that existed in a previous sync but is no longer
 * in the registry is flagged via `removed_at`, never deleted - so
 * `_meta_fields` remains a durable record answerable by a plain SQL
 * query even for things that used to exist.
 *
 * @param {import('knex').Knex} db
 * @param {import('../models/registry.js').ModelRegistry} modelRegistry
 * @returns {Promise<MetaSyncResult>}
 */
export async function syncMeta(db, modelRegistry) {
  const now = new Date();
  /** @type {MetaSyncResult} */
  const result = { modelsUpserted: [], fieldsUpserted: [], modelsRemoved: [], fieldsRemoved: [] };

  await db.transaction(async (trx) => {
    for (const modelName of modelRegistry.listModels()) {
      const model = modelRegistry.getModel(modelName);
      const modelId = await ensureMetaModel(trx, model, now);
      result.modelsUpserted.push(modelName);

      const currentFieldNames = new Set([
        ...Object.keys(model.fields),
        ...Object.keys(model.relations ?? {}),
      ]);
      for (const [fieldName, field] of Object.entries(model.fields)) {
        await ensureMetaField(trx, modelId, model.name, fieldName, field, model.columns[fieldName], now);
        result.fieldsUpserted.push(`${modelName}.${fieldName}`);
      }
      for (const [relationName, relation] of Object.entries(model.relations ?? {})) {
        await ensureMetaRelation(trx, modelId, model.name, relationName, relation, model, now);
        result.fieldsUpserted.push(`${modelName}.${relationName}`);
      }

      const removedFields = await flagRemovedFields(trx, modelId, currentFieldNames, now);
      result.fieldsRemoved.push(...removedFields.map((f) => `${modelName}.${f}`));
    }

    const removedModels = await flagRemovedModels(trx, modelRegistry, now);
    result.modelsRemoved.push(...removedModels);
  });

  return result;
}
