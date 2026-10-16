/**
 * Counts the number of queries Knex actually executes while running
 * `fn`, by listening to Knex's own 'query' event for the duration of
 * the call. This is the reusable harness the roadmap calls for so N+1
 * regressions can be caught with a real assertion ("this stayed at 2
 * queries regardless of row count") rather than eyeballing SQL output.
 *
 * @param {import('knex').Knex} db
 * @param {() => Promise<unknown>} fn
 * @returns {Promise<{ count: number, result: unknown }>}
 */
export async function countQueries(db, fn) {
  let count = 0;
  const onQuery = () => {
    count += 1;
  };

  db.on("query", onQuery);
  try {
    const result = await fn();
    return { count, result };
  } finally {
    db.removeListener("query", onQuery);
  }
}
