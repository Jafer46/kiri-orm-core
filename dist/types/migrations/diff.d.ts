export type DiffPlan = {
    /**
     * - model names that are entirely new
     */
    createModels: string[];
    /**
     * - previously-active models no longer
     * in the registry: { modelName, tableName, fields, columns } where
     * `fields`/`columns` are reconstructed from the stored meta rows'
     * `options` JSON, so a rollback can recreate the table's schema
     * even though the model no longer exists in code.
     */
    dropModels: Object[];
    /**
     * - { modelName, fromTable, toTable } -
     * detected with certainty (not a heuristic): the model's `name` is
     * its stable identity in `_meta_models`, so if that same name's
     * resolved table name changed, it's unambiguously a rename.
     */
    renameModels: Object[];
    /**
     * -
     * advisory only: models present in the old snapshot but absent from
     * the registry, alongside newly-registered models, when neither list
     * is empty and no explicit `modelRenames` resolved them. There's no
     * way to know if these are genuinely related without the caller
     * telling us - this exists purely to prompt "did you mean to rename
     * one of these?" rather than to guess.
     */
    possibleModelRenames: {
        removed: string[];
        added: string[];
    } | null;
    /**
     * - per model
     */
    fieldChanges: Record<string, FieldChangePlan>;
};
export type FieldChangePlan = {
    /**
     * - new field names on an existing model
     */
    addFields: string[];
    /**
     * - { fieldName, columnName, field } for
     * fields removed from the model; `field` is reconstructed from the
     * stored meta row's `options` JSON for rollback purposes.
     */
    dropFields: Object[];
    /**
     * - { from, to } - resolved via the
     * caller's explicit `fieldRenames` option. Fully reversible: a
     * RENAME COLUMN loses no data.
     */
    renameFields: Object[];
    /**
     * - { fieldName, fromColumn, toColumn } -
     * detected with certainty: same field `name` (the stable identity
     * key in `_meta_fields`), only its resolved column name changed
     * (e.g. an explicit `column` option was added/changed). Not a
     * heuristic guess, same reasoning as renameModels above.
     */
    columnRenames: Object[];
    /**
     * - { fieldName, from, to } - flagged
     * but never auto-migrated (see generateMigration).
     */
    typeChanges: Object[];
    /**
     * -
     * advisory only, same rationale as possibleModelRenames but at the
     * field level (e.g. `customerId` renamed to `clientId` in code).
     */
    possibleFieldRenames: {
        removed: string[];
        added: string[];
    } | null;
};
/**
 * @typedef {Object} DiffPlan
 * @property {string[]} createModels - model names that are entirely new
 * @property {Object[]} dropModels - previously-active models no longer
 *   in the registry: { modelName, tableName, fields, columns } where
 *   `fields`/`columns` are reconstructed from the stored meta rows'
 *   `options` JSON, so a rollback can recreate the table's schema
 *   even though the model no longer exists in code.
 * @property {Object[]} renameModels - { modelName, fromTable, toTable } -
 *   detected with certainty (not a heuristic): the model's `name` is
 *   its stable identity in `_meta_models`, so if that same name's
 *   resolved table name changed, it's unambiguously a rename.
 * @property {{removed: string[], added: string[]}|null} possibleModelRenames -
 *   advisory only: models present in the old snapshot but absent from
 *   the registry, alongside newly-registered models, when neither list
 *   is empty and no explicit `modelRenames` resolved them. There's no
 *   way to know if these are genuinely related without the caller
 *   telling us - this exists purely to prompt "did you mean to rename
 *   one of these?" rather than to guess.
 * @property {Record<string, FieldChangePlan>} fieldChanges - per model
 */
/**
 * @typedef {Object} FieldChangePlan
 * @property {string[]} addFields - new field names on an existing model
 * @property {Object[]} dropFields - { fieldName, columnName, field } for
 *   fields removed from the model; `field` is reconstructed from the
 *   stored meta row's `options` JSON for rollback purposes.
 * @property {Object[]} renameFields - { from, to } - resolved via the
 *   caller's explicit `fieldRenames` option. Fully reversible: a
 *   RENAME COLUMN loses no data.
 * @property {Object[]} columnRenames - { fieldName, fromColumn, toColumn } -
 *   detected with certainty: same field `name` (the stable identity
 *   key in `_meta_fields`), only its resolved column name changed
 *   (e.g. an explicit `column` option was added/changed). Not a
 *   heuristic guess, same reasoning as renameModels above.
 * @property {Object[]} typeChanges - { fieldName, from, to } - flagged
 *   but never auto-migrated (see generateMigration).
 * @property {{removed: string[], added: string[]}|null} possibleFieldRenames -
 *   advisory only, same rationale as possibleModelRenames but at the
 *   field level (e.g. `customerId` renamed to `clientId` in code).
 */
/**
 * Compares `modelRegistry`'s current state against what's recorded in
 * `_meta_models`/`_meta_fields` (Phase 4) - NOT live schema
 * introspection. This is precisely the reason Phase 4 exists: model
 * and field *identity* (their `name`) is stable in the metadata even
 * when their resolved table/column name changes, so a table or column
 * rename is detected with certainty rather than guessed. A field or
 * model being renamed *in code* (a genuinely new identity) can't be
 * known for certain and is only ever surfaced as an advisory
 * `possible...Renames` hint unless the caller explicitly resolves it.
 *
 * @param {import('knex').Knex} db
 * @param {import('../models/registry.js').ModelRegistry} modelRegistry
 * @param {Object} [options]
 * @param {Record<string, string>} [options.modelRenames] - { oldModelName: newModelName }
 * @param {Record<string, Record<string, string>>} [options.fieldRenames] - { modelName: { oldFieldName: newFieldName } }
 * @returns {Promise<DiffPlan>}
 */
export declare function diffSchema(db: import('knex').Knex, modelRegistry: import('../models/registry.js').ModelRegistry, options?: {
    modelRenames?: Record<string, string>;
    fieldRenames?: Record<string, Record<string, string>>;
}): Promise<DiffPlan>;
