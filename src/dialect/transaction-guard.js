import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Thrown when code running inside a transaction issues a query on the connection itself
 * (no `{ trx }`) while that transaction holds SQLite's only pooled connection: the query would
 * wait for a connection the transaction never gives back, until Knex's acquire timeout (60 s).
 */
export class TransactionDeadlockError extends Error {
  constructor(message) {
    super(message);
    this.name = "TransactionDeadlockError";
  }
}

const GUARDED = Symbol.for("kiri-orm.transactionGuard");

/** The transactions open in the current async flow, outermost first: [{ client, trx }]. */
const openTransactions = new AsyncLocalStorage();

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
export function guardTransactions(db) {
  const client = db?.client;
  if (!client || client[GUARDED] || !isSqlite(client)) return db;
  client[GUARDED] = true;

  const transaction = client.transaction;
  client.transaction = function guardedTransaction(container, config, outerTx) {
    if (typeof container !== "function") return transaction.call(this, container, config, outerTx);
    const scoped = (trx) => {
      const outer = openTransactions.getStore() ?? [];
      return openTransactions.run([...outer, { client, trx }], () => container(trx));
    };
    return transaction.call(this, scoped, config, outerTx);
  };

  const acquireConnection = client.acquireConnection;
  client.acquireConnection = function guardedAcquireConnection() {
    const holding = openTransactions.getStore()?.some((open) => open.client === client && !open.trx.isCompleted());
    if (holding && poolMax(client) === 1) {
      return Promise.reject(
        new TransactionDeadlockError(
          "A query was issued outside the open transaction it runs in. On SQLite the transaction holds the only " +
            "connection, so this query would wait for it forever. Pass the transaction to it: " +
            "Model.find(filter, { trx }), Model.create(data, { trx }), document.save({ trx }). " +
            "Hooks don't receive the transaction yet, so a hook can't query the database while it runs inside one " +
            "(e.g. a child's beforeCreate during a nested create): move that query out of the hook for now."
        )
      );
    }
    return acquireConnection.call(this);
  };

  return db;
}

function isSqlite(client) {
  const name = client.config?.client;
  return typeof name === "string" ? name.includes("sqlite") : /sqlite/i.test(client.dialect ?? "");
}

function poolMax(client) {
  return client.pool?.max ?? client.config?.pool?.max ?? 1;
}
