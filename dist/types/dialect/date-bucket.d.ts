/**
 * Date buckets: truncating a date/datetime column to the start of its hour, day, week,
 * month, quarter or year, so rows can be grouped by period.
 *
 * Postgres and SQLite spell this completely differently (`date_trunc` vs `strftime`), and
 * store dates differently (a real `timestamptz`/`date` vs epoch milliseconds in an integer
 * column), so the SQL lives here, once, behind one function. Both return the bucket the
 * same way - an ISO-8601 UTC string, `2024-03-01T00:00:00Z` - which the caller turns
 * into a Date. Returning a string instead of letting each driver hand back its own
 * timestamp type is what keeps the result identical on both databases.
 *
 * Buckets are in UTC, always. Without that, Postgres would bucket by the session's time
 * zone, and the same data would group differently depending on how the server is configured
 * (a row at 23:30 UTC on March 15 lands in March 16 on a server set to Africa/Addis_Ababa).
 * Weeks start on Monday (ISO 8601) on both.
 */
export declare const DATE_BUCKETS: string[];
/**
 * Builds the SQL expression for one bucket.
 *
 * Nothing user-supplied is spliced in: `bucket` must be one of DATE_BUCKETS (checked here),
 * and the column goes through Knex's `??` identifier binding. The bucket name is inlined as
 * a literal on purpose - as a bound parameter, Postgres would see `date_trunc($1, ...)` in
 * the SELECT list and `date_trunc($2, ...)` in GROUP BY as two different expressions and
 * refuse to run the query.
 *
 * @param {import('knex').Knex} db - decides the dialect
 * @param {string} column - the column name (not the field name)
 * @param {"hour"|"day"|"week"|"month"|"quarter"|"year"} bucket
 * @param {{ fieldType?: "date"|"datetime" }} [options] - Postgres stores `date` and
 *   `datetime` as different types and each needs its own conversion to a UTC timestamp
 * @returns {{ sql: string, bindings: string[] }} an expression yielding the bucket start as `...Z` text
 */
export declare function dateBucketSql(db: import('knex').Knex, column: string, bucket: "hour" | "day" | "week" | "month" | "quarter" | "year", { fieldType }?: {
    fieldType?: "date" | "datetime";
}): {
    sql: string;
    bindings: string[];
};
/**
 * Turns a bucket string produced by dateBucketSql() into a Date (or null for a row whose
 * date was null).
 * @param {string|null|undefined} value
 * @returns {Date|null}
 */
export declare function parseBucket(value: string | null | undefined): Date | null;
