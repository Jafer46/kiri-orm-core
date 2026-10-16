export type SyncResult = {
    tablesCreated: string[];
    /**
     * - tableName -> column names added
     */
    columnsAdded: Record<string, string[]>;
    /**
     * - e.g. "post.author_id -> user.id"
     */
    foreignKeysAdded: string[];
    /**
     * - things sync() didn't change but you should know about
     */
    warnings: string[];
    meta: import('../meta/sync-meta.js').MetaSyncResult;
};
/**
 * @typedef {Object} SyncResult
 * @property {string[]} tablesCreated
 * @property {Record<string, string[]>} columnsAdded - tableName -> column names added
 * @property {string[]} foreignKeysAdded - e.g. "post.author_id -> user.id"
 * @property {string[]} warnings - things sync() didn't change but you should know about
 * @property {import('../meta/sync-meta.js').MetaSyncResult} meta
 */
/**
 * Syncs every model registered on `modelRegistry` to real tables in
 * `db`. Additive-only: creates tables/columns that don't exist yet,
 * never drops or alters existing ones. Safe to call repeatedly -
 * running it twice in a row with no model changes is a no-op on the
 * second call (idempotent).
 *
 * This is deliberately simple for Phase 3. Real migration files with
 * diffing, renames, and reversibility come in Phase 6, once the
 * DB-persisted metamodel from Phase 4 exists to diff against - trying
 * to detect renames vs drop+add from live schema introspection alone
 * is exactly the kind of guess that goes wrong silently, so it's not
 * attempted here.
 *
 * As of Phase 4, sync() also ensures the `_meta_models`/`_meta_fields`
 * tables exist and upserts them to reflect the current registry state
 * (see the `meta` module), so the schema stays queryable as data.
 *
 * As of Phase 7, sync() also ensures the pivot table for every
 * `belongsToMany` relation exists (see the `relations` module).
 *
 * Every `belongsTo` relation becomes a real FOREIGN KEY with its `onDelete` action, so the
 * database - not the ORM - enforces referential integrity. New tables are created in
 * dependency order so each key points at a table that exists. A table that already exists
 * is not altered, except for the columns it's missing (which bring their keys with them);
 * existing foreign key columns that lack their constraint are reported in `warnings`, and
 * added when `addMissingForeignKeys` is set (this can fail if rows already violate it).
 *
 * @param {import('knex').Knex} db
 * @param {import('../models/registry.js').ModelRegistry} modelRegistry
 * @param {Object} [options]
 * @param {import('./column-builder-registry.js').ColumnBuilderRegistry} [options.columnBuilderRegistry]
 * @param {boolean} [options.addMissingForeignKeys] - add constraints that existing tables lack
 * @returns {Promise<SyncResult>}
 */
export declare function sync(db: import('knex').Knex, modelRegistry: import('../models/registry.js').ModelRegistry, options?: {
    columnBuilderRegistry?: import('./column-builder-registry.js').ColumnBuilderRegistry;
    addMissingForeignKeys?: boolean;
}): Promise<SyncResult>;
