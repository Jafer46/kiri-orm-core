import knexFactory from "knex";
import { guardTransactions } from "./dialect/transaction-guard.js";

/**
 * Supported dialects for Phase 0. More can be added later without
 * touching call sites, since everything routes through this factory.
 */
const DIALECTS = /** @type {const} */ (["sqlite", "postgres"]);

/**
 * @typedef {Object} ConnectionConfig
 * @property {"sqlite"|"postgres"} dialect
 * @property {string} [filename]            - sqlite only, e.g. ":memory:" or a file path
 * @property {string} [connectionString]    - postgres only
 * @property {boolean|object} [ssl]         - postgres only: passed to the `pg` driver (`true`, or
 *   `{ rejectUnauthorized, ca, ... }`). Since 0.1.7.
 * @property {{ min?: number, max?: number, idleTimeoutMillis?: number, afterCreate?: Function }} [pool]
 *   - Knex pool settings (Postgres default: min 2, max 10; SQLite: 1 connection). An `afterCreate`
 *   of your own runs after the ORM's (SQLite turns foreign keys on there). Since 0.1.7.
 * @property {number} [acquireConnectionTimeout] - ms to wait for a free pooled connection before
 *   failing (Knex default 60000). Since 0.1.7.
 */

/**
 * Creates a Knex instance for the given dialect. This is the single
 * chokepoint all DB access should go through, so dialect quirks stay
 * isolated here instead of leaking into model/query code.
 *
 * @param {ConnectionConfig} config
 * @returns {import('knex').Knex}
 */
export function createConnection(config) {
  if (!config || !DIALECTS.includes(config.dialect)) {
    throw new Error(
      `Unsupported or missing dialect. Expected one of: ${DIALECTS.join(", ")}`,
    );
  }

  const shared = config.acquireConnectionTimeout === undefined ? {} : { acquireConnectionTimeout: config.acquireConnectionTimeout };

  if (config.dialect === "sqlite") {
    const { afterCreate: userAfterCreate, ...pool } = config.pool ?? {};
    return guardTransactions(knexFactory({
      client: "better-sqlite3",
      connection: {
        filename: config.filename ?? ":memory:",
      },
      useNullAsDefault: true,
      ...shared,
      pool: {
        ...pool,
        // SQLite only enforces foreign keys on connections that ask for it (off by default).
        afterCreate(connection, done) {
          connection.pragma("foreign_keys = ON");
          if (userAfterCreate) userAfterCreate(connection, done);
          else done(null, connection);
        },
      },
    }));
  }

  if (config.dialect === "postgres") {
    if (!config.connectionString) {
      throw new Error("postgres dialect requires a connectionString");
    }
    return knexFactory({
      client: "pg",
      connection: config.ssl === undefined ? config.connectionString : { connectionString: config.connectionString, ssl: config.ssl },
      ...shared,
      ...(config.pool ? { pool: config.pool } : {}),
    });
  }

  // Unreachable given the guard above, but keeps the function honest.
  throw new Error(`Unhandled dialect: ${config.dialect}`);
}

/**
 * Gracefully closes a Knex connection. Wrapped so call sites (and tests)
 * don't need to know about `.destroy()` vs other cleanup APIs if that
 * ever changes per-dialect.
 *
 * @param {import('knex').Knex} db
 */
export async function closeConnection(db) {
  await db.destroy();
}

export { DIALECTS };
