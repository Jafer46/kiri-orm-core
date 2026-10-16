import { getConnection } from "./connect.js";

/**
 * Runs `fn` inside a transaction on the default connection, passing
 * the transaction object through so it can be handed to any Model
 * method's `{ trx }` option (`Order.create(data, { trx })`) to
 * include it in the same atomic unit. Every `Model` method - `create`,
 * `find`, `findOne`, `updateMany`, `deleteMany`, `attach`, `detach`,
 * and a document's own `save()`/`delete()` - accepts `{ trx }` for
 * exactly this reason.
 *
 * Without this, a multi-step write across Models (e.g. creating an
 * order plus each of its line items) has no way to be atomic: each
 * `Model.create()` call would hit the default connection directly,
 * with no way to roll every step back together if a later one fails.
 *
 * If `fn` throws (or returns a rejected promise), Knex rolls the
 * transaction back automatically and the rejection propagates here.
 *
 * @template T
 * @param {(trx: import('knex').Knex.Transaction) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function transaction(fn) {
  return getConnection().transaction(fn);
}
