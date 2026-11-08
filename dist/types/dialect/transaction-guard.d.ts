/**
 * Thrown when code running inside a transaction issues a query on the connection itself
 * (no `{ trx }`) while that transaction holds SQLite's only pooled connection: the query would
 * wait for a connection the transaction never gives back, until Knex's acquire timeout (60 s).
 */
export declare class TransactionDeadlockError extends Error {
    constructor(message: any);
}
/**
 * Makes a SQLite connection fail fast, instead of hanging, on the one query pattern that can
 * never complete: inside `db.transaction(fn)`, a query that skips the transaction and goes to
 * `db` (or the global connection) - a model call without `{ trx }`, or a hook that queries the
 * database during a nested create. SQLite's pool has a single connection and the transaction
 * holds it, so that query waits forever (until Knex gives up after 60 s, before 0.1.7).
 *
 * Only that case is refused. A query from *another* request while a transaction runs is not in
 * the transaction's async flow, so it still queues for the connection the normal way. Pools of
 * more than one connection (a custom `pool.max`) are left alone: there the query just runs on
 * another connection.
 *
 * Wraps two methods on this connection's Knex client: `transaction()` (to record, per async
 * flow, which transaction is open - savepoints go through a separate client and are untouched)
 * and `acquireConnection()` (to check that record). Queries made through a transaction never
 * call the second one: they reuse the transaction's connection. Idempotent; no-op for Postgres.
 *
 * @template {import('knex').Knex} T
 * @param {T} db
 * @returns {T}
 */
export declare function guardTransactions<T extends import('knex').Knex>(db: T): T;
