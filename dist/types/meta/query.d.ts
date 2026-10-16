/**
 * Returns the `_meta_models` row for a model, or undefined if it's
 * never been synced. Excludes models flagged as removed unless
 * `includeRemoved` is set.
 *
 * @param {import('knex').Knex} db
 * @param {string} modelName
 * @param {{ includeRemoved?: boolean }} [options]
 */
export declare function getModelMeta(db: import('knex').Knex, modelName: string, options?: {
    includeRemoved?: boolean;
}): Promise<any>;
/**
 * Returns the `_meta_fields` rows for a model, ordered by field name.
 * This is the plain-SQL-queryable answer to "what fields does model X
 * have, and what are their types" that Phase 4 exists to provide.
 *
 * @param {import('knex').Knex} db
 * @param {string} modelName
 * @param {{ includeRemoved?: boolean }} [options]
 */
export declare function getFieldsMeta(db: import('knex').Knex, modelName: string, options?: {
    includeRemoved?: boolean;
}): Promise<any[]>;
/**
 * Returns all `_meta_models` rows, ordered by name. Excludes models
 * flagged as removed unless `includeRemoved` is set.
 *
 * @param {import('knex').Knex} db
 * @param {{ includeRemoved?: boolean }} [options]
 */
export declare function listModelsMeta(db: import('knex').Knex, options?: {
    includeRemoved?: boolean;
}): Promise<any[]>;
