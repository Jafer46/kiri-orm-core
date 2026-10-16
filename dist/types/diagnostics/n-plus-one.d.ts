/**
 * An N+1 detector: notices when the same SQL statement is sent over and over, which is what
 * "load the parent, then query for each child" looks like from the database's side - one query
 * for the list, then one more per row.
 *
 * It watches the connection's `query` events (which also carry the queries of any transaction on
 * it), reduces every statement to its SHAPE, and counts repeats of a shape. Two statements have the
 * same shape when only their values differ:
 *
 *   select * from post where id = $1                  -- and the same with = ?, or any id
 *   select * from comment where post_id in (?, ?, ?)  -- and the same with a list of any length
 *
 * So looping `findOne({ id })` over a hundred ids is one shape seen 100 times, while one batched
 * `find({ with })` is a few different shapes seen once each.
 *
 * It is a heuristic and says so: a legitimate loop (a batch job paging through rows) repeats a
 * statement too. That is why it reports and, unless you ask it to, doesn't throw - and why the
 * threshold and the time window are yours to set. Only SELECTs are counted by default: a loop of
 * inserts is a different, usually deliberate, pattern.
 *
 * Meant for development and tests, not production: it adds a cheap string pass per statement.
 *
 * It reports WHAT repeated (the statement, and how many times), not WHERE it was called from. That
 * would need the caller's stack, and by the time knex emits its query event that is gone: query builders
 * are non-native thenables, and V8's async stack traces don't continue through them. The statement itself
 * - it names the table and the column - is what to search your code for.
 *
 * @typedef {{ shape: string, sql: string, statement: string, count: number }} Finding
 */
export type Finding = {
    shape: string;
    sql: string;
    statement: string;
    count: number;
};
export declare const DEFAULT_THRESHOLD = 5;
/**
 * Reduces a statement to its shape: the same text with the values and the list lengths taken out.
 * Postgres `$1` and SQLite `?` placeholders both become `?`; `in (?, ?, ?)` becomes `in (?)`; a
 * multi-row `values (?, ?), (?, ?)` becomes one row.
 *
 * @param {string} sql
 * @returns {string}
 */
export declare function normalizeSql(sql: string): string;
/** The kind of statement: `select`, `insert`, `update`, `delete`, or a bookkeeping word. A CTE counts as a select. */
export declare function statementOf(sql: any): string;
export declare class NPlusOneError extends Error {
    findings: Finding[];
    /** @param {Finding[]} findings */
    constructor(findings: Finding[]);
}
/** A readable report: each repeated statement, how often, and what to do about it. */
export declare function describeFindings(findings: any): string;
export declare class QueryMonitor {
    #private;
    /**
     * @param {object} [options]
     * @param {number} [options.threshold] - repeats of one shape that count as N+1 (default 5)
     * @param {number} [options.windowMs] - a shape's count starts over after this long without it; `Infinity`
     *   (the default) counts everything seen. A live watcher usually wants a few hundred ms.
     * @param {string[]} [options.statements] - which statements to count (default `["select"]`)
     * @param {RegExp[]} [options.ignore] - statements to skip, matched against the SQL; added to the ORM's own
     *   (sequence maintenance), not replacing them
     * @param {(finding: Finding) => void} [options.onDetect] - called once when a shape first reaches the threshold
     * @param {() => number} [options.now] - clock, for tests
     */
    constructor({ threshold, windowMs, statements, ignore, onDetect, now }?: {
        threshold?: number;
        windowMs?: number;
        statements?: string[];
        ignore?: RegExp[];
        onDetect?: (finding: Finding) => void;
        now?: () => number;
    });
    /** Starts listening on a connection (or transaction). One monitor watches one connection at a time. */
    attach(db: any): this;
    /** Stops listening. Safe to call twice. The findings so far are kept. */
    detach(): this;
    /** Forgets everything counted so far. */
    reset(): this;
    /** The shapes that reached the threshold, most repeated first. @returns {Finding[]} */
    get findings(): Finding[];
    /** Throws NPlusOneError if anything was found. */
    assertClean(): void;
}
/**
 * Runs `fn` while watching `db`, then reports what repeated. Never throws for findings.
 *
 * @template T
 * @param {import('knex').Knex} db
 * @param {() => Promise<T>} fn
 * @param {ConstructorParameters<typeof QueryMonitor>[0]} [options]
 * @returns {Promise<{ result: T, findings: Finding[] }>}
 */
export declare function scanForNPlusOne<T>(db: import('knex').Knex, fn: () => Promise<T>, options?: ConstructorParameters<typeof QueryMonitor>[0]): Promise<{
    result: T;
    findings: Finding[];
}>;
/**
 * A live watcher for development: warns (once per statement) on the console the moment one shape
 * repeats `threshold` times within `windowMs`. Call `.detach()` to stop.
 *
 * @param {import('knex').Knex} db
 * @param {ConstructorParameters<typeof QueryMonitor>[0]} [options] - `windowMs` defaults to 250, `onDetect` to console.warn
 * @returns {QueryMonitor}
 */
export declare function watchForNPlusOne(db: import('knex').Knex, options?: ConstructorParameters<typeof QueryMonitor>[0]): QueryMonitor;
