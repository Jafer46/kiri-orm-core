import { isPostgres } from "../crud/sequence.js";

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

export const DATE_BUCKETS = ["hour", "day", "week", "month", "quarter", "year"];

const ISO = `YYYY-MM-DD"T"HH24:MI:SS"Z"`;

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
export function dateBucketSql(db, column, bucket, { fieldType = "datetime" } = {}) {
  if (!DATE_BUCKETS.includes(bucket)) {
    throw new TypeError(`Unknown date bucket ${JSON.stringify(bucket)}. Buckets: ${DATE_BUCKETS.join(", ")}`);
  }
  return isPostgres(db) ? postgresBucket(column, bucket, fieldType) : sqliteBucket(column, bucket);
}

function postgresBucket(column, bucket, fieldType) {
  // timestamptz -> the same instant as a UTC wall-clock timestamp. A `date` has no zone: just widen it.
  const utc = fieldType === "date" ? "??::timestamp" : "?? AT TIME ZONE 'UTC'";
  return { sql: `to_char(date_trunc('${bucket}', ${utc}), '${ISO}')`, bindings: [column] };
}

function sqliteBucket(column, bucket) {
  // Dates are stored as epoch milliseconds; strftime wants seconds. `/ 1000.0` keeps pre-1970 values correct.
  const t = "??/1000.0, 'unixepoch'";
  const fmt = (pattern, ...extra) => `strftime('${pattern}', ${t}${extra.length ? `, ${extra.join(", ")}` : ""})`;

  switch (bucket) {
    case "hour":
      return { sql: fmt("%Y-%m-%dT%H:00:00Z"), bindings: [column] };
    case "day":
      return { sql: fmt("%Y-%m-%dT00:00:00Z"), bindings: [column] };
    case "month":
      return { sql: fmt("%Y-%m-01T00:00:00Z"), bindings: [column] };
    case "year":
      return { sql: fmt("%Y-01-01T00:00:00Z"), bindings: [column] };
    case "week":
      // Step back to Monday: %w is 0 (Sunday)..6, so (%w + 6) % 7 days since Monday.
      return {
        sql: fmt("%Y-%m-%dT00:00:00Z", `'-' || ((CAST(strftime('%w', ${t}) AS INTEGER) + 6) % 7) || ' days'`),
        bindings: [column, column],
      };
    case "quarter":
      // First month of the quarter: 1, 4, 7 or 10.
      return {
        sql: `${fmt("%Y-")} || printf('%02d', ((CAST(strftime('%m', ${t}) AS INTEGER) - 1) / 3) * 3 + 1) || '-01T00:00:00Z'`,
        bindings: [column, column],
      };
    default:
      throw new TypeError(`Unhandled bucket ${bucket}`); // unreachable: checked above
  }
}

/**
 * Turns a bucket string produced by dateBucketSql() into a Date (or null for a row whose
 * date was null).
 * @param {string|null|undefined} value
 * @returns {Date|null}
 */
export function parseBucket(value) {
  return value === null || value === undefined ? null : new Date(value);
}
