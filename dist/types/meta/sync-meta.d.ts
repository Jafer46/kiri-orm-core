export type MetaSyncResult = {
    modelsUpserted: string[];
    /**
     * - "modelName.fieldName"
     */
    fieldsUpserted: string[];
    /**
     * - flagged, not deleted
     */
    modelsRemoved: string[];
    /**
     * - "modelName.fieldName", flagged not deleted
     */
    fieldsRemoved: string[];
};
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
export declare function syncMeta(db: import('knex').Knex, modelRegistry: import('../models/registry.js').ModelRegistry): Promise<MetaSyncResult>;
