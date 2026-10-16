import { describe, it, expect } from "vitest";
import { createConnection, closeConnection } from "../../src/index.js";
import { createIsolatedPgSchema } from "../helpers/dialects.js";
import { ModelRegistry } from "../../src/models/registry.js";
import { sync } from "../../src/schema/sync.js";
import { Repository } from "../../src/crud/repository.js";
import { AGG_MODELS, seedAgg } from "../helpers/aggregate-fixture.js";

/**
 * Postgres' date_trunc() works in the *session* time zone, so a bucket computed naively
 * changes with how the server happens to be configured: a row at 23:30 UTC on Jan 31 belongs
 * to February on a server set to Africa/Addis_Ababa (UTC+3). Buckets here are defined in UTC;
 * this runs the same queries under several session zones and requires identical answers.
 * (SQLite has no session zone; its buckets are covered by aggregate.test.js.)
 */
const ZONES = ["UTC", "Africa/Addis_Ababa", "America/Los_Angeles", "Pacific/Kiritimati"];

describe.runIf(process.env.TEST_PG_CONNECTION_STRING)("date buckets don't depend on the session time zone - postgres", () => {
  async function resultsIn(zone) {
    const isolated = await createIsolatedPgSchema();
    const url = new URL(isolated.connectionString);
    url.searchParams.set("options", `${url.searchParams.get("options")} -c TimeZone=${zone}`);
    const db = createConnection({ dialect: "postgres", connectionString: url.toString() });
    try {
      const registry = new ModelRegistry();
      AGG_MODELS.forEach((model) => registry.define(model));
      await sync(db, registry);
      await seedAgg(db);
      const repo = new Repository(db, registry.getModel("order"), undefined, registry);

      const [{ tz }] = (await db.raw("show timezone")).rows.map((row) => ({ tz: row.TimeZone }));
      const run = async (groupBy) => (await repo.aggregate({}, { groupBy, aggregates: { n: "count" } })).map((r) => [Object.values(r)[0]?.toISOString() ?? null, r.n]);
      return {
        tz,
        day: await run("placedAt:day"),
        week: await run("placedAt:week"),
        month: await run("placedAt:month"),
        quarter: await run("placedAt:quarter"),
        hour: await run("placedAt:hour"),
        shippedMonth: await run("shippedOn:month"), // a `date` column, a different code path
      };
    } finally {
      await closeConnection(db);
      await isolated.drop();
    }
  }

  it("gives the same buckets in every session zone", async () => {
    const baseline = await resultsIn("UTC");
    expect(baseline.tz).toBe("UTC");
    expect(baseline.month[0]).toEqual(["2024-01-01T00:00:00.000Z", 1]); // Jan 31 23:30Z is January, not February

    for (const zone of ZONES.slice(1)) {
      const { tz, ...results } = await resultsIn(zone);
      expect(tz).toBe(zone); // the session really did run in that zone
      const { tz: _ignored, ...expected } = baseline;
      expect(results, `buckets in ${zone}`).toEqual(expected);
    }
  });
});
