/**
 * Runs `fn` inside a Knex transaction, passing the transaction object
 * through so it can be handed to Repository methods' `{ trx }` option
 * (e.g. `repo.create(data, { trx })`) to include them in the same
 * atomic unit. This is a thin pass-through to Knex's own
 * `db.transaction()` - it exists mainly so the transaction API is
 * discoverable from `@kiri-orm/core`'s exports without needing to know
 * Knex's API is what's underneath.
 *
 * If `fn` throws (or returns a rejected promise), Knex rolls the
 * transaction back automatically and the rejection propagates to the
 * caller here.
 *
 * @template T
 * @param {import('knex').Knex} db
 * @param {(trx: import('knex').Knex.Transaction) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function runInTransaction(db, fn) {
  return db.transaction(fn);
}
