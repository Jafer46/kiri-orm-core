import { createConnection, closeConnection } from "../connection.js";
import { guardTransactions } from "../dialect/transaction-guard.js";
import { state } from "./state.js";

/**
 * Sets the default connection every `createModel()`-defined Model
 * uses. Accepts either a connection config (`{ dialect, filename }` /
 * `{ dialect, connectionString }`, same as `createConnection()`) or an
 * already-built Knex instance directly, for cases where the app needs
 * to configure Knex itself beyond what `createConnection()` exposes.
 *
 * Call this once at startup, before performing any queries through a
 * Model (defining models with `createModel()` doesn't need a
 * connection yet - only actually running a query does, so model
 * definitions and `connect()` can happen in either order at
 * module-load time).
 *
 * @param {import('../connection.js').ConnectionConfig|import('knex').Knex} configOrConnection
 * @returns {import('knex').Knex}
 */
export function connect(configOrConnection) {
  // A pool connect() built itself from a config is closed when it is replaced (before 0.1.7 it was
  // left open: calling connect() again leaked it, and a leaked Postgres pool keeps the process
  // alive). A Knex instance the app passed in is the app's to close, so it is left alone.
  const previous = state.ownsConnection ? state.connection : null;
  const ownsNew = typeof configOrConnection !== "function";
  const next = ownsNew ? createConnection(configOrConnection) : guardTransactions(configOrConnection);
  state.connection = next;
  state.ownsConnection = ownsNew;
  if (previous && previous !== next) closeWhenIdle(previous);
  return state.connection;
}

/**
 * Closes a replaced pool in the background (connect() is synchronous) once nothing is using it:
 * destroying it right away would abort queries and transactions still running on it.
 */
function closeWhenIdle(db) {
  const pool = db.client?.pool;
  const busy = () => pool && (pool.numUsed() > 0 || pool.numPendingAcquires() > 0 || pool.numPendingCreates() > 0);
  const attempt = () => {
    if (busy()) setTimeout(attempt, 50).unref?.();
    else closeConnection(db).catch(() => {});
  };
  attempt();
}

/**
 * Returns the default connection set by `connect()`. Throws a clear
 * error if `connect()` hasn't been called yet, rather than failing
 * deep inside a query with a confusing "cannot read property of null".
 *
 * @returns {import('knex').Knex}
 */
export function getConnection() {
  if (!state.connection) {
    throw new Error(
      "No default connection - call connect({ dialect, ... }) once at startup before performing any queries."
    );
  }
  return state.connection;
}

/**
 * Closes the default connection, if one is set.
 */
export async function disconnect() {
  if (state.connection) {
    await closeConnection(state.connection);
    state.connection = null;
    state.ownsConnection = false;
  }
}
