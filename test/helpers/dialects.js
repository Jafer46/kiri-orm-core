import { randomBytes } from "node:crypto";
import { createConnection, closeConnection } from "../../src/index.js";

/**
 * SQLite is always available (in-memory, no external service needed) so
 * it's used for fast unit tests and as a baseline in integration tests.
 *
 * Postgres is only exercised when TEST_PG_CONNECTION_STRING is set
 * (e.g. in CI via a docker service, or locally against a running
 * Postgres instance). Tests that need Postgres should call
 * `requirePostgres()` and skip themselves gracefully otherwise, so the
 * suite still runs green on a machine without Docker/Postgres.
 */

export function sqliteConnection() {
  return createConnection({ dialect: "sqlite", filename: ":memory:" });
}

export function postgresAvailable() {
  return Boolean(process.env.TEST_PG_CONNECTION_STRING);
}

export function postgresConnection() {
  if (!postgresAvailable()) {
    throw new Error(
      "TEST_PG_CONNECTION_STRING is not set - call postgresAvailable() first"
    );
  }
  return createConnection({
    dialect: "postgres",
    connectionString: process.env.TEST_PG_CONNECTION_STRING,
  });
}

/**
 * Creates a throwaway Postgres schema and returns a connection string whose
 * `search_path` points at it, so every table a test's `sync()` creates lands inside it
 * instead of in the shared database. `drop()` removes the schema and everything in it.
 *
 * Why: `sync()` never drops tables, so tests sharing one Postgres database see each
 * other's tables and rows (SQLite doesn't have the problem - a fresh `:memory:` per
 * connection). Isolating per test is what makes the Postgres CI job trustworthy.
 *
 * @returns {Promise<{ connectionString: string, schema: string, drop: () => Promise<void> }>}
 */
export async function createIsolatedPgSchema() {
  const baseUrl = process.env.TEST_PG_CONNECTION_STRING;
  const schema = `t_${randomBytes(6).toString("hex")}`;

  const admin = createConnection({ dialect: "postgres", connectionString: baseUrl });
  await admin.raw(`create schema "${schema}"`);

  const url = new URL(baseUrl);
  url.searchParams.set("options", `-c search_path=${schema}`);

  return {
    connectionString: url.toString(),
    schema,
    async drop() {
      await admin.raw(`drop schema if exists "${schema}" cascade`);
      await closeConnection(admin);
    },
  };
}

/**
 * Returns the list of dialect fixtures to run a given test suite
 * against. Used with `describe.each` / `it.each` so every phase's
 * tests run on both dialects automatically, per the roadmap's
 * "test against both before moving on" rule.
 *
 * The Postgres fixture is marked `isolated`: withConnection() gives each call its own
 * schema (see createIsolatedPgSchema()).
 */
export function eachDialect() {
  const dialects = [{ name: "sqlite", connect: sqliteConnection }];
  if (postgresAvailable()) {
    postgresConnection.isolated = true;
    dialects.push({ name: "postgres", connect: postgresConnection });
  }
  return dialects;
}

/**
 * Runs `fn(db)` on a fresh connection and closes it afterwards. For an `isolated`
 * Postgres fixture the connection is also confined to its own schema, dropped at the end.
 */
export async function withConnection(connect, fn) {
  if (connect.isolated) {
    const isolated = await createIsolatedPgSchema();
    const db = createConnection({ dialect: "postgres", connectionString: isolated.connectionString });
    try {
      await fn(db);
    } finally {
      await closeConnection(db);
      await isolated.drop();
    }
    return;
  }
  const db = connect();
  try {
    await fn(db);
  } finally {
    await closeConnection(db);
  }
}
