import knexFactory from "knex";

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
      `Unsupported or missing dialect. Expected one of: ${DIALECTS.join(", ")}`
    );
  }

  if (config.dialect === "sqlite") {
    return knexFactory({
      client: "better-sqlite3",
      connection: {
        filename: config.filename ?? ":memory:",
      },
      useNullAsDefault: true,
      // SQLite only enforces foreign keys on connections that ask for it (off by default).
      pool: {
        afterCreate(connection, done) {
          connection.pragma("foreign_keys = ON");
          done(null, connection);
        },
      },
    });
  }

  if (config.dialect === "postgres") {
    if (!config.connectionString) {
      throw new Error("postgres dialect requires a connectionString");
    }
    return knexFactory({
      client: "pg",
      connection: config.connectionString,
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
