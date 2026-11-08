export type NormalizedDateColumn = {
    model: string;
    field: string;
    table: string;
    column: string;
    /**
     * - values rewritten
     */
    rows: number;
};
/**
 * @typedef {Object} NormalizedDateColumn
 * @property {string} model
 * @property {string} field
 * @property {string} table
 * @property {string} column
 * @property {number} rows - values rewritten
 */
/**
 * Rewrites `date` values that SQLite still holds as epoch milliseconds into the "YYYY-MM-DD"
 * text the ORM has written since 0.1.3. Since 0.1.7.
 *
 * 0.1.0-0.1.2 stored `date` fields as epoch ms (Knex binds a Date as its valueOf() on SQLite).
 * 0.1.6+ reads those rows fine, but a column holding both forms still compares and sorts wrong
 * in SQL - SQLite orders every number before every text - so a filter like
 * `[["on", ">=", "2024-01-01"]]` or `orderBy: "on"` gives wrong results until it's rewritten.
 *
 * Each old value becomes the calendar day the read path already shows for it (see the `date`
 * field type's cast), so nothing visible changes - only the stored form. Runs in one transaction;
 * safe to run again (it only touches numeric values). Postgres stores a real `date` and has
 * nothing to rewrite, so it returns an empty list there.
 *
 * @param {import('knex').Knex} db
 * @param {import('../models/registry.js').ModelRegistry} modelRegistry
 * @param {{ models?: string[], fieldTypeRegistry?: import('../fields/registry.js').FieldTypeRegistry }} [options]
 * @returns {Promise<NormalizedDateColumn[]>} one entry per date column that had values to rewrite
 */
export declare function normalizeDateColumns(db: import('knex').Knex, modelRegistry: import('../models/registry.js').ModelRegistry, options?: {
    models?: string[];
    fieldTypeRegistry?: import('../fields/registry.js').FieldTypeRegistry;
}): Promise<NormalizedDateColumn[]>;
