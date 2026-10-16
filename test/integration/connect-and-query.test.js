import { describe, it, expect } from "vitest";
import { eachDialect, withConnection, postgresAvailable } from "../helpers/dialects.js";

/**
 * Phase 0 exit criteria: `pnpm test` runs a trivial "connect and
 * query" test on both SQLite and Postgres in CI.
 *
 * Postgres is skipped locally when TEST_PG_CONNECTION_STRING isn't
 * set, but always runs in CI (see .github/workflows/ci.yml which
 * spins up a postgres service and sets that env var).
 */
describe.each(eachDialect())("connect and query - %s", ({ name, connect }) => {
  it(`runs a trivial query against ${name}`, async () => {
    await withConnection(connect, async (db) => {
      const result = await db.raw(
        name === "postgres" ? "select 1 + 1 as sum" : "select 1 + 1 as sum"
      );
      const row = name === "postgres" ? result.rows[0] : result[0];
      expect(row.sum).toBe(2);
    });
  });

  it(`can create and drop a scratch table on ${name}`, async () => {
    await withConnection(connect, async (db) => {
      await db.schema.createTable("phase0_scratch", (t) => {
        t.increments("id");
        t.string("label");
      });

      const exists = await db.schema.hasTable("phase0_scratch");
      expect(exists).toBe(true);

      await db("phase0_scratch").insert({ label: "hello" });
      const rows = await db("phase0_scratch").select("*");
      expect(rows).toHaveLength(1);
      expect(rows[0].label).toBe("hello");

      await db.schema.dropTable("phase0_scratch");
    });
  });
});

describe("postgres availability notice", () => {
  it("logs whether postgres integration tests are active", () => {
    // Not a real assertion - just makes it obvious in test output
    // why postgres cases are missing when running locally without Docker.
    if (!postgresAvailable()) {
      console.warn(
        "[integration] TEST_PG_CONNECTION_STRING not set - postgres cases skipped locally. They run in CI."
      );
    }
    expect(true).toBe(true);
  });
});
