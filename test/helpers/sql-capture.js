/**
 * Captures the SQL text and bindings of every query Knex executes
 * while running `fn`, via Knex's own 'query' event. Unlike
 * countQueries() (which only counts), this returns the actual SQL so
 * a test can assert an UPDATE statement mentions exactly the columns
 * that were supposed to change - genuine SQL-level verification
 * rather than trusting that "the record looked right afterward" means
 * dirty tracking worked correctly.
 *
 * @param {import('knex').Knex} db
 * @param {() => Promise<unknown>} fn
 * @returns {Promise<{ queries: { sql: string, bindings: unknown[] }[], result: unknown }>}
 */
export async function captureQueries(db, fn) {
  const queries = [];
  const onQuery = (query) => {
    queries.push({ sql: query.sql, bindings: query.bindings });
  };

  db.on("query", onQuery);
  try {
    const result = await fn();
    return { queries, result };
  } finally {
    db.removeListener("query", onQuery);
  }
}
