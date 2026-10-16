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
export declare function ensureMetaModel(trx: import('knex').Knex, model: import('../models/define-model.js').ModelDescriptor, now: Date): Promise<number>;
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
export declare function ensureMetaField(trx: import('knex').Knex, modelId: number, modelName: string, fieldName: string, field: import('../fields/define-field.js').FieldDescriptor, columnName: string, now: Date): Promise<void>;
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
export declare function ensureMetaRelation(trx: import('knex').Knex, modelId: number, modelName: string, relationName: string, relation: import('../relations/define-relation.js').RelationDescriptor, model: import('../models/define-model.js').ModelDescriptor, now: Date): Promise<void>;
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
export declare function flagRemovedModels(trx: import('knex').Knex, modelRegistry: import('../models/registry.js').ModelRegistry, now: Date): Promise<string[]>;
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
export declare function flagRemovedFields(trx: import('knex').Knex, modelId: number, currentFieldNames: Set<string>, now: Date): Promise<string[]>;
