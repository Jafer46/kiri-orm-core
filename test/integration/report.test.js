import { describe, it, expect } from "vitest";
import { eachIsolatedDialect } from "../helpers/isolated-dialects.js";
import { captureQueries } from "../helpers/sql-capture.js";
import { seedAgg, seedManyOrders } from "../helpers/aggregate-fixture.js";
import { makeReportApi, REPORT_SURFACES } from "../helpers/report-fixture.js";
import { ValidationError } from "../../src/crud/errors.js";

const selects = (queries) => queries.filter(({ sql }) => /^\s*select/i.test(sql));
const MATRIX = eachIsolatedDialect().flatMap((dialect) =>
  REPORT_SURFACES.map((surface) => ({ name: `${dialect.name} / ${surface}`, surface, run: dialect.run }))
);

describe.each(MATRIX)("reports - $name", ({ surface, run }) => {
  const setup = (fn) =>
    run(async (db) => {
      const api = await makeReportApi(surface, db);
      await seedAgg(db);
      return fn({ api, sales: api.report("salesByCustomer"), monthly: api.report("monthlySales"), db });
    });

  const ADA = { customerId: 1, customerName: "Ada", country: "UK", orders: 2, revenue: 150, itemsTotal: 150, avgOrder: 75 };
  const ALAN = { customerId: 2, customerName: "Alan", country: "UK", orders: 2, revenue: 220, itemsTotal: 200, avgOrder: 110 };
  const GRACE = { customerId: 3, customerName: "Grace", country: "US", orders: 1, revenue: 300, itemsTotal: 300, avgOrder: 300 };
  const NOBODY = { customerId: null, customerName: null, country: null, orders: 1, revenue: 10, itemsTotal: null, avgOrder: 10 };

  describe("find", () => {
    it("returns one row per group, in the report's own order, with plain fields next to aggregates", () =>
      setup(async ({ sales }) => {
        expect(await sales.find()).toEqual([GRACE, ALAN, ADA, NOBODY]); // orderBy: -revenue
      }));

    it("declares columns in definition order, with computed fields where they were declared", () =>
      setup(async ({ sales }) => {
        const [row] = await sales.find();
        expect(Object.keys(row)).toEqual(["customerId", "customerName", "country", "orders", "revenue", "itemsTotal", "avgOrder"]);
        expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
      }));

    it("applies the report's own `where` before grouping (the cancelled order is gone, not just hidden)", () =>
      setup(async ({ sales }) => {
        const rows = await sales.find();
        expect(rows.find((r) => r.customerId === 3).revenue).toBe(300); // 375 with the cancelled 75
        expect(rows.reduce((sum, r) => sum + r.orders, 0)).toBe(6);
      }));

    it("date-bucket keys, countDistinct and max, with nulls last", () =>
      setup(async ({ monthly }) => {
        const rows = await monthly.find();
        expect(rows.map((r) => [r.month?.toISOString().slice(0, 7) ?? null, r.orders, r.revenue, r.buyers, r.biggest])).toEqual([
          ["2024-01", 1, 100, 1, 100],
          ["2024-02", 3, 270, 2, 200],
          ["2024-05", 2, 375, 1, 300],
          [null, 1, 10, 0, 10],
        ]);
      }));

    it("overrides the default order and pages", () =>
      setup(async ({ sales }) => {
        const ids = async (options) => (await sales.find({}, options)).map((r) => r.customerId);
        expect(await ids({ orderBy: "customerId" })).toEqual([1, 2, 3, null]);
        expect(await ids({ orderBy: "-orders", limit: 2 })).toEqual([1, 2]); // both have 2 orders; the tie falls back to the group key, ascending
        expect(await ids({ limit: 2, offset: 1 })).toEqual([2, 1]);
      }));
  });

  describe("filtering in the report's own terms", () => {
    it("a key field filters rows; through a path or a renamed key it still works", () =>
      setup(async ({ sales }) => {
        const ids = async (filter) => (await sales.find(filter)).map((r) => r.customerId);
        expect(await ids([["customerName", "=", "Ada"]])).toEqual([1]);
        expect(await ids([["country", "=", "US"]])).toEqual([3]);
        expect(await ids({ country: "UK" })).toEqual([2, 1]);
        expect(await ids([["customerId", "in", [1, 3]]])).toEqual([3, 1]);
      }));

    it("pattern operators work on a key that reads through a relation", () =>
      setup(async ({ sales }) => {
        const ids = async (filter) => (await sales.find(filter)).map((r) => r.customerId);
        expect(await ids([["customerName", "like", "A%"]])).toEqual([2, 1]); // Alan, Ada
        expect(await ids([["customerName", "like", "A%"], ["revenue", ">", 200]])).toEqual([2]); // the example from the docs
        expect(await ids([["customerName", "!=", "Ada"]])).toEqual([3, 2]); // a customer-less order has no name to compare, as in SQL
      }));

    it("an aggregate field filters groups, and the two combine in one filter", () =>
      setup(async ({ sales }) => {
        const ids = async (filter) => (await sales.find(filter)).map((r) => r.customerId);
        expect(await ids([["revenue", ">", 200]])).toEqual([3, 2]);
        expect(await ids([["revenue", ">", 100], ["country", "=", "UK"]])).toEqual([2, 1]);
        expect(await ids([["itemsTotal", "=", null]])).toEqual([null]);
        expect(await ids([["orders", ">=", 2]])).toEqual([2, 1]);
      }));

    it("a filter on a field the report doesn't have is refused, listing the ones it does", () =>
      setup(async ({ sales, db }) => {
        const { queries } = await captureQueries(db, async () => {
          const error = await sales.find([["total", ">", 1]]).catch((e) => e);
          expect(error).toBeInstanceOf(ValidationError);
          expect(error.fieldErrors.filter[0]).toMatch(/"total" is not a field of report "salesByCustomer"\. Filterable fields: customerId, customerName, country, orders, revenue, itemsTotal/);
          expect(error.fieldErrors.filter[0]).not.toMatch(/avgOrder/);
        });
        expect(queries).toHaveLength(0);
      }));

    it("computed fields can be neither filtered nor sorted by (the database never sees them)", () =>
      setup(async ({ sales }) => {
        await expect(sales.find([["avgOrder", ">", 50]])).rejects.toThrow(/"avgOrder" is a computed field of report.*can't be filtered/);
        const error = await sales.find({}, { orderBy: "-avgOrder" }).catch((e) => e);
        expect(error).toBeInstanceOf(ValidationError);
        expect(error.fieldErrors.orderBy[0]).toMatch(/"avgOrder" is a computed field/);
      }));

    it("a mixed OR across a key and an aggregate is refused, as in aggregate()", () =>
      setup(async ({ sales }) => {
        await expect(sales.find(["|", ["country", "=", "UK"], ["revenue", ">", 100]])).rejects.toThrow(/mixes fields of the rows with aggregates/);
      }));
  });

  describe("findOne and count", () => {
    it("findOne returns the first row in the report's order, or null", () =>
      setup(async ({ sales }) => {
        expect(await sales.findOne()).toEqual(GRACE);
        expect(await sales.findOne([["country", "=", "UK"]])).toEqual(ALAN);
        expect(await sales.findOne([["revenue", ">", 9999]])).toBeNull();
      }));

    it("count is the number of rows (groups), ignoring paging", () =>
      setup(async ({ sales, monthly }) => {
        expect(await sales.count()).toBe(4);
        expect(await sales.count([["revenue", ">", 200]])).toBe(2);
        expect(await sales.count({}, { limit: 1, offset: 3 })).toBe(4);
        expect(await sales.count([["revenue", ">", 9999]])).toBe(0);
        expect(await monthly.count()).toBe(4);
      }));
  });

  describe("one statement", () => {
    it("find, findOne and count are each a single SELECT, for 7 orders or 307", () =>
      setup(async ({ sales, db }) => {
        const statements = async () => ({
          find: (await captureQueries(db, () => sales.find([["revenue", ">", 0]]))).queries.length,
          findOne: (await captureQueries(db, () => sales.findOne())).queries.length,
          count: (await captureQueries(db, () => sales.count())).queries.length,
        });
        expect(await statements()).toEqual({ find: 1, findOne: 1, count: 1 });
        await seedManyOrders(db, 300);
        expect(await statements()).toEqual({ find: 1, findOne: 1, count: 1 });
      }));

    it("toSQL shows the statement without running it", () =>
      setup(async ({ sales, db }) => {
        const { queries, result } = await captureQueries(db, async () => sales.toSQL([["revenue", ">", 100]]));
        expect(queries).toHaveLength(0);
        expect(result.sql).toMatch(/left join/i);
        expect(result.sql).toMatch(/group by/i);
        expect(result.sql).toMatch(/having/i);
      }));
  });

  describe("transient: nothing is created for a report", () => {
    it("has no table and is not in the model registry", () =>
      setup(async ({ api, db }) => {
        for (const name of ["sales_by_customer", "salesByCustomer", "monthly_sales", "monthlySales"]) {
          expect(await db.schema.hasTable(name)).toBe(false);
        }
        if (api.registry) expect(api.registry.hasModel("salesByCustomer")).toBe(false);
      }));
  });
});
