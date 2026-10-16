/**
 * Runs a report (see defineReport()). Every call is one SQL statement, whatever the grain,
 * the number of aggregates, or the relations they cross.
 *
 * It is a thin layer over `aggregate()`: the report's fields are translated into `groupBy` /
 * `aggregates`, its `where` is ANDed in front of the caller's filter, and computed fields are applied to
 * the rows afterwards. So everything aggregate() guarantees holds here too - to-many aggregates
 * can't inflate each other, a filter on an aggregate becomes HAVING, buckets are UTC, nulls sort last.
 *
 * The filter you pass to `find()` is written in terms of the REPORT's fields:
 * `[["customerName", "=", "Ada"], ["revenue", ">", 1000]]`. A condition on a key field filters rows
 * before grouping; on an aggregate, groups after.
 *
 * Models are looked up on first use, not at definition, so a report may be defined before the
 * models it reads. The first use also validates the whole definition against them.
 */
export declare class ReportHandle {
    #private;
    /**
     * @param {import('./define-report.js').ReportDescriptor} descriptor
     * @param {object} env - how to reach the database and models, looked up at call time so a report
     *   follows its client (and a transaction) rather than capturing one connection
     * @param {() => import('knex').Knex} env.db
     * @param {() => import('../models/registry.js').ModelRegistry} env.registry
     * @param {import('../fields/registry.js').FieldTypeRegistry} [env.fieldTypeRegistry]
     */
    constructor(descriptor: import('./define-report.js').ReportDescriptor, env: {
        db: () => import('knex').Knex;
        registry: () => import('../models/registry.js').ModelRegistry;
        fieldTypeRegistry?: import('../fields/registry.js').FieldTypeRegistry;
    });
    get name(): string;
    /** The (frozen) definition: `{ name, from, where, orderBy, fields }`. */
    get descriptor(): import("./define-report.js").ReportDescriptor;
    /**
     * The rows of the report matching `filter`.
     *
     * @param {Record<string, unknown>|unknown[]} [filter] - in terms of the report's fields
     * @param {{ orderBy?: unknown, limit?: number, offset?: number, trx?: import('knex').Knex.Transaction }} [options]
     *   `orderBy` defaults to the report's own. Computed fields can't be filtered or sorted by.
     * @returns {Promise<Array<Record<string, unknown>>>} plain objects, fields in the order the report declares them
     */
    find(filter?: Record<string, unknown> | unknown[], options?: {
        orderBy?: unknown;
        limit?: number;
        offset?: number;
        trx?: import('knex').Knex.Transaction;
    }): Promise<Array<Record<string, unknown>>>;
    /** The first row (in the report's order) matching `filter`, or `null`. */
    findOne(filter?: {}, options?: {}): Promise<Record<string, unknown>>;
    /**
     * How many rows (groups) the report has for `filter` - ignoring orderBy and paging. One statement.
     * @returns {Promise<number>}
     */
    count(filter?: {}, options?: {}): Promise<number>;
    /** The SQL (and bindings) `find()` would run, without running it. Handy for inspecting or EXPLAINing a report. */
    toSQL(filter?: {}, options?: {}): import("knex").Knex.SqlNative;
}
