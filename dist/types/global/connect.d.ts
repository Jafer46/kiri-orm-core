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
export declare function connect(configOrConnection: import('../connection.js').ConnectionConfig | import('knex').Knex): import('knex').Knex;
/**
 * Returns the default connection set by `connect()`. Throws a clear
 * error if `connect()` hasn't been called yet, rather than failing
 * deep inside a query with a confusing "cannot read property of null".
 *
 * @returns {import('knex').Knex}
 */
export declare function getConnection(): import('knex').Knex;
/**
 * Closes the default connection, if one is set.
 */
export declare function disconnect(): Promise<void>;
