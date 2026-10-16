import { randomBytes } from "node:crypto";
import { createConnection, closeConnection } from "../../src/index.js";

/**
 * Like `eachDialect()`, but every `run(fn)` call gets a database that
 * no other test has touched.
 *
 * SQLite already gets that for free (a fresh `:memory:` per
 * connection). Postgres does not: `sync()` never drops tables, so
 * tests that share one database see each other's tables and rows. Here
 * each run gets its own throwaway *schema* - the connection's
 * `search_path` points at it, so every table `sync()` creates lands
 * inside it - and the schema is dropped afterwards.
 *
 * Usage:
 *   describe.each(eachIsolatedDialect())("thing - $name", ({ run }) => {
 *     it("works", () => run(async (db) => { ... }));
 *   });
 */
export function eachIsolatedDialect() {
  const dialects = [{ name: "sqlite", run: runOnSqlite }];
  if (process.env.TEST_PG_CONNECTION_STRING) dialects.push({ name: "postgres", run: runOnPostgres });
  return dialects;
}

async function runOnSqlite(fn) {
  const db = createConnection({ dialect: "sqlite", filename: ":memory:" });
  try {
    return await fn(db);
  } finally {
    await closeConnection(db);
  }
}

async function runOnPostgres(fn) {
  const baseUrl = process.env.TEST_PG_CONNECTION_STRING;
  const schema = `t_${randomBytes(6).toString("hex")}`;

  const admin = createConnection({ dialect: "postgres", connectionString: baseUrl });
  await admin.raw(`create schema "${schema}"`);

  const url = new URL(baseUrl);
  url.searchParams.set("options", `-c search_path=${schema}`);
  const db = createConnection({ dialect: "postgres", connectionString: url.toString() });

  try {
    return await fn(db);
  } finally {
    await closeConnection(db);
    await admin.raw(`drop schema "${schema}" cascade`);
    await closeConnection(admin);
  }
}
