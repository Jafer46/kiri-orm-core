import { describe, it, expect } from "vitest";
import { DATE_BUCKETS, dateBucketSql, parseBucket } from "../../../src/dialect/date-bucket.js";

// All dateBucketSql() looks at is which dialect the connection is.
const pg = { client: { config: { client: "pg" } } };
const sqlite = { client: { config: { client: "better-sqlite3" } } };

describe("dateBucketSql", () => {
  it("knows exactly six buckets", () => {
    expect(DATE_BUCKETS).toEqual(["hour", "day", "week", "month", "quarter", "year"]);
  });

  describe("postgres", () => {
    it.each(DATE_BUCKETS)("%s: date_trunc on the UTC wall clock, rendered as ISO text", (bucket) => {
      const { sql, bindings } = dateBucketSql(pg, "t.placed_at", bucket);
      expect(sql).toContain(`date_trunc('${bucket}', ?? AT TIME ZONE 'UTC')`);
      expect(sql).toMatch(/^to_char\(/);
      expect(bindings).toEqual(["t.placed_at"]);
    });

    it("a `date` column is widened, not time-zone converted (it has no zone)", () => {
      const { sql } = dateBucketSql(pg, "t.d", "month", { fieldType: "date" });
      expect(sql).toContain("date_trunc('month', ??::timestamp)");
      expect(sql).not.toContain("AT TIME ZONE");
    });

    it("inlines the bucket name instead of binding it (a bound name would make SELECT and GROUP BY differ)", () => {
      const { sql, bindings } = dateBucketSql(pg, "c", "week");
      expect(sql).toContain("'week'");
      expect(bindings).toEqual(["c"]);
    });
  });

  describe("sqlite", () => {
    it.each(DATE_BUCKETS)("%s: strftime over epoch milliseconds", (bucket) => {
      const { sql, bindings } = dateBucketSql(sqlite, "t.placed_at", bucket);
      expect(sql).toContain("strftime(");
      expect(sql).toContain("/1000.0, 'unixepoch'");
      expect(bindings.every((b) => b === "t.placed_at")).toBe(true);
      expect(sql.match(/\?\?/g)).toHaveLength(bindings.length); // one binding per placeholder
    });

    it("week steps back to Monday; quarter derives the first month of the quarter", () => {
      expect(dateBucketSql(sqlite, "c", "week").sql).toContain("+ 6) % 7");
      expect(dateBucketSql(sqlite, "c", "quarter").sql).toContain("- 1) / 3) * 3 + 1");
    });
  });

  it("refuses anything that isn't a known bucket, so nothing user-typed reaches the SQL", () => {
    for (const dialect of [pg, sqlite]) {
      expect(() => dateBucketSql(dialect, "c", "decade")).toThrow(/Unknown date bucket "decade"/);
      expect(() => dateBucketSql(dialect, "c", "day'); drop table x; --")).toThrow(TypeError);
    }
  });
});

describe("parseBucket", () => {
  it("parses the ISO text a bucket produces, and passes null through", () => {
    expect(parseBucket("2024-03-01T00:00:00Z")).toEqual(new Date(Date.UTC(2024, 2, 1)));
    expect(parseBucket(null)).toBeNull();
    expect(parseBucket(undefined)).toBeNull();
  });
});
