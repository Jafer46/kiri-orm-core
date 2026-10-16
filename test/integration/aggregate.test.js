import { describe, it, expect } from "vitest";
import { eachIsolatedDialect } from "../helpers/isolated-dialects.js";
import { captureQueries } from "../helpers/sql-capture.js";
import { makeApi, SURFACES } from "../helpers/select-fixture.js";
import { AGG_MODELS, seedAgg, seedManyOrders } from "../helpers/aggregate-fixture.js";
import { ValidationError } from "../../src/crud/errors.js";

const d = (iso) => new Date(iso);
const selects = (queries) => queries.filter(({ sql }) => /^\s*select/i.test(sql));

/** Every case runs on both dialects x all three ways of calling it. */
const MATRIX = eachIsolatedDialect().flatMap((dialect) =>
  SURFACES.map((surface) => ({ name: `${dialect.name} / ${surface}`, surface, run: dialect.run }))
);

describe.each(MATRIX)("aggregate - $name", ({ surface, run }) => {
  const setup = (fn) =>
    run(async (db) => {
      const api = await makeApi(surface, db, AGG_MODELS);
      await seedAgg(db);
      const order = api.handle("order");
      return fn({ order, api, db });
    });

  describe("whole-table aggregates", () => {
    it("computes every function in one row, as numbers", () =>
      setup(async ({ order }) => {
        const [row] = await order.aggregate({}, {
          aggregates: {
            n: "count", withNote: { count: "note" }, statuses: { countDistinct: "status" },
            revenue: { sum: "total" }, units: { sum: "qty" }, mean: { avg: "total" },
            cheapest: { min: "total" }, dearest: { max: "total" },
          },
        });
        expect(row).toEqual({ n: 7, withNote: 5, statuses: 3, revenue: 755, units: 18, mean: expect.any(Number), cheapest: 10, dearest: 300 });
        expect(row.mean).toBeCloseTo(755 / 7, 6);
        for (const value of Object.values(row)) expect(typeof value).toBe("number"); // not Postgres' bigint/numeric strings
      }));

    it("min/max keep the field's own type: Dates for date fields, text for text", () =>
      setup(async ({ order }) => {
        const [row] = await order.aggregate({}, {
          aggregates: { first: { min: "placedAt" }, last: { max: "placedAt" }, firstShip: { min: "shippedOn" }, lastShip: { max: "shippedOn" }, lo: { min: "note" }, hi: { max: "note" } },
        });
        expect(row.first).toEqual(d("2024-01-31T23:30:00Z"));
        expect(row.last).toEqual(d("2024-05-20T10:00:00Z"));
        expect(row.firstShip).toBeInstanceOf(Date);
        expect(row.firstShip.toISOString().slice(0, 10)).toBe("2024-02-02");
        expect(row.lastShip.toISOString().slice(0, 10)).toBe("2024-05-21");
        expect([row.lo, row.hi]).toEqual(["a", "g"]);
      }));

    it("an empty match gives one row: count 0, everything else null; with groupBy, no rows", () =>
      setup(async ({ order }) => {
        const none = { status: "nope" };
        expect(await order.aggregate(none, { aggregates: { n: "count", s: { sum: "total" }, a: { avg: "total" }, lo: { min: "placedAt" } } }))
          .toEqual([{ n: 0, s: null, a: null, lo: null }]);
        expect(await order.aggregate(none, { groupBy: "status", aggregates: { n: "count" } })).toEqual([]);
      }));

    it("returns plain objects", () =>
      setup(async ({ order }) => {
        const [row] = await order.aggregate({}, { aggregates: { n: "count" } });
        expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
      }));
  });

  describe("shortcuts", () => {
    it("count / sum / avg / min / max, with plain, domain and relation filters", () =>
      setup(async ({ order }) => {
        expect(await order.count()).toBe(7);
        expect(await order.count({ status: "paid" })).toBe(5);
        expect(await order.count([["total", ">", 100]])).toBe(2);
        expect(await order.count([["customer.country", "=", "US"]])).toBe(2);
        expect(await order.sum("total")).toBe(755);
        expect(await order.sum("qty", { status: "paid" })).toBe(14);
        expect(await order.avg("qty", { status: "paid" })).toBeCloseTo(2.8, 10);
        expect(await order.min("total")).toBe(10);
        expect(await order.max("placedAt")).toEqual(d("2024-05-20T10:00:00Z"));
      }));

    it("on an empty match: count 0, the rest null", () =>
      setup(async ({ order }) => {
        const none = { status: "nope" };
        expect(await order.count(none)).toBe(0);
        expect(await order.sum("total", none)).toBeNull();
        expect(await order.avg("total", none)).toBeNull();
        expect(await order.min("total", none)).toBeNull();
        expect(await order.max("placedAt", none)).toBeNull();
      }));

    it("reject computed and wrongly-typed fields like aggregate() does", () =>
      setup(async ({ order }) => {
        await expect(order.sum("label")).rejects.toThrow(/computed field/);
        await expect(order.sum("note")).rejects.toThrow(/needs an integer or float/);
        await expect(order.avg("nope")).rejects.toThrow(/unknown field "nope"/);
      }));
  });

  describe("groupBy", () => {
    it("groups by a field, ordered by the group key", () =>
      setup(async ({ order }) => {
        expect(await order.aggregate({}, { groupBy: "status", aggregates: { n: "count", revenue: { sum: "total" } } })).toEqual([
          { status: "cancelled", n: 1, revenue: 75 },
          { status: "paid", n: 5, revenue: 660 },
          { status: "refunded", n: 1, revenue: 20 },
        ]);
      }));

    it("groups by several fields; a null key is its own group and sorts last", () =>
      setup(async ({ order }) => {
        const rows = await order.aggregate({}, { groupBy: ["status", "customerId"], aggregates: { n: "count", revenue: { sum: "total" } } });
        expect(rows.map((r) => [r.status, r.customerId, r.n, r.revenue])).toEqual([
          ["cancelled", 3, 1, 75],
          ["paid", 1, 2, 150],
          ["paid", 2, 1, 200],
          ["paid", 3, 1, 300],
          ["paid", null, 1, 10],
          ["refunded", 2, 1, 20],
        ]);
      }));

    it("casts group keys like any stored value (boolean, datetime)", () =>
      setup(async ({ api }) => {
        const rows = await api.handle("customer").aggregate({}, { groupBy: "vip", aggregates: { n: "count" } });
        expect(rows).toEqual([{ vip: false, n: 1 }, { vip: true, n: 2 }]);

        const byTime = await api.handle("order").aggregate({}, { groupBy: "placedAt", aggregates: { n: "count" }, limit: 1 });
        expect(byTime[0].placedAt).toEqual(d("2024-01-31T23:30:00Z"));
      }));

    it("groupBy alone (no aggregates) lists the distinct values", () =>
      setup(async ({ order }) => {
        expect(await order.aggregate({}, { groupBy: "status" })).toEqual([{ status: "cancelled" }, { status: "paid" }, { status: "refunded" }]);
      }));
  });

  describe("ordering and paging", () => {
    it("orders by an aggregate, descending, with limit and offset", () =>
      setup(async ({ order }) => {
        const options = { groupBy: "customerId", aggregates: { revenue: { sum: "total" } } };
        const top = await order.aggregate({}, { ...options, orderBy: "-revenue", limit: 2 });
        expect(top.map((r) => [r.customerId, r.revenue])).toEqual([[3, 375], [2, 220]]);
        const next = await order.aggregate({}, { ...options, orderBy: "-revenue", limit: 2, offset: 1 });
        expect(next.map((r) => [r.customerId, r.revenue])).toEqual([[2, 220], [1, 150]]);
      }));

    it("nulls sort last in both directions, on both databases", () =>
      setup(async ({ order }) => {
        const ids = async (orderBy) => (await order.aggregate({}, { groupBy: "customerId", aggregates: { n: "count" }, orderBy })).map((r) => r.customerId);
        expect(await ids("customerId")).toEqual([1, 2, 3, null]);
        expect(await ids("-customerId")).toEqual([3, 2, 1, null]);
      }));

    it("accepts every orderBy spelling, and ties fall back to the group key", () =>
      setup(async ({ order }) => {
        const options = { groupBy: "customerId", aggregates: { n: "count" } };
        const ids = async (orderBy) => (await order.aggregate({}, { ...options, orderBy })).map((r) => r.customerId);
        expect(await ids(["n", "desc"])).toEqual([1, 2, 3, null]); // n: 2,2,2,1 - the three 2s tie, key order breaks it
        expect(await ids([["n", "asc"], { field: "customerId", direction: "desc" }])).toEqual([null, 3, 2, 1]);
      }));

    it("the default order is stable, so a bare limit is meaningful", () =>
      setup(async ({ order }) => {
        const first = await order.aggregate({}, { groupBy: "status", aggregates: { n: "count" }, limit: 1 });
        expect(first).toEqual([{ status: "cancelled", n: 1 }]);
      }));

    it("an aggregate named like another field's column can't hijack ORDER BY", () =>
      setup(async ({ order }) => {
        // `shippingFee` lives in column shipping_fee, and the aggregate is *named* shipping_fee.
        const rows = (orderBy) => order.aggregate({}, { groupBy: "shippingFee", aggregates: { shipping_fee: { sum: "total" } }, orderBy });
        expect((await rows("shippingFee")).map((r) => [r.shippingFee, r.shipping_fee])).toEqual([[1, 500], [2, 170], [3, 85]]);
        expect((await rows("shipping_fee")).map((r) => r.shippingFee)).toEqual([3, 2, 1]);
      }));
  });

  describe("WHERE and HAVING from one filter", () => {
    const byCustomer = { groupBy: "customerId", aggregates: { orders: "count", revenue: { sum: "total" }, first: { min: "shippedOn" } } };

    it("rows go to WHERE (before grouping), aggregates to HAVING (after)", () =>
      setup(async ({ order, db }) => {
        const filter = [["status", "=", "paid"], ["revenue", ">", 100]];
        const { queries, result } = await captureQueries(db, () => order.aggregate(filter, byCustomer));
        expect(result.map((r) => [r.customerId, r.orders, r.revenue])).toEqual([[1, 2, 150], [2, 1, 200], [3, 1, 300]]);

        const sql = selects(queries)[0].sql;
        expect(selects(queries)).toHaveLength(1);
        const whereClause = sql.match(/\bwhere\b([\s\S]*?)\bgroup by\b/i)[1];
        const havingClause = sql.match(/\bhaving\b([\s\S]*?)(?:\border by\b|$)/i)[1];
        expect(whereClause).toMatch(/status/);
        expect(whereClause).not.toMatch(/sum\(/i); // the aggregate condition is not a row filter
        expect(havingClause).toMatch(/sum\(/i);
        expect(havingClause).not.toMatch(/status/); // ...and the row condition is not a group filter
      }));

    it("the filtered rows are excluded from the aggregate (WHERE really runs first)", () =>
      setup(async ({ order }) => {
        // customer 3 has a cancelled 75 and a paid 300; with status = paid its revenue is 300, not 375
        const rows = await order.aggregate([["status", "=", "paid"]], byCustomer);
        expect(rows.find((r) => r.customerId === 3).revenue).toBe(300);
        expect(await order.aggregate([["revenue", ">", 350]], byCustomer)).toHaveLength(1); // unfiltered: 375
      }));

    it("having supports = != in, 'not in', and OR / NOT between aggregates", () =>
      setup(async ({ order }) => {
        const customers = async (filter) => (await order.aggregate(filter, byCustomer)).map((r) => r.customerId);
        expect(await customers([["orders", "in", [1]]])).toEqual([null]);
        expect(await customers([["orders", "=", 2]])).toEqual([1, 2, 3]);
        expect(await customers([["orders", "!=", 2]])).toEqual([null]);
        expect(await customers([["orders", "not in", [1]]])).toEqual([1, 2, 3]);
        expect(await customers([["orders", "in", []]])).toEqual([]);
        expect(await customers(["|", ["orders", "=", 1], ["revenue", ">", 300]])).toEqual([3, null]);
        expect(await customers(["!", ["orders", "=", 2]])).toEqual([null]);
      }));

    it("having compares min/max in the column's own type, and understands null", () =>
      setup(async ({ order }) => {
        const customers = async (filter) => (await order.aggregate(filter, byCustomer)).map((r) => r.customerId);
        expect(await customers([["first", "=", null]])).toEqual([null]); // customer-less order never shipped
        expect(await customers([["first", "!=", null]])).toEqual([1, 2, 3]);
        expect(await customers([["first", ">", d("2024-02-10T00:00:00Z")]])).toEqual([2, 3]);
      }));

    it("a plain-object filter may name an aggregate, and mixes with row fields", () =>
      setup(async ({ order }) => {
        const customers = async (filter) => (await order.aggregate(filter, byCustomer)).map((r) => r.customerId);
        expect(await customers({ orders: 1 })).toEqual([null]);
        expect(await customers({ status: "paid", orders: 1 })).toEqual([2, 3, null]);
        expect(await customers({ status: "paid" })).toEqual([1, 2, 3, null]); // no aggregate named: the ordinary path
      }));

    it("an OR or NOT mixing rows with aggregates is rejected, before any SQL", () =>
      setup(async ({ order, db }) => {
        const { queries } = await captureQueries(db, async () => {
          const error = await order.aggregate(["|", ["status", "=", "paid"], ["revenue", ">", 1]], byCustomer).catch((e) => e);
          expect(error).toBeInstanceOf(ValidationError);
          expect(error.fieldErrors.filter[0]).toMatch(/mixes fields of the rows with aggregates/);
          await expect(order.aggregate(["!", ["&", ["status", "=", "paid"], ["revenue", ">", 1]]], byCustomer)).rejects.toThrow(/mixes fields/);
        });
        expect(queries).toHaveLength(0);
      }));

    it("a bucket can't be filtered by its alias; the message points at the field", () =>
      setup(async ({ order }) => {
        const error = await order.aggregate([["placedAt_month", "=", d("2024-02-01T00:00:00Z")]], { groupBy: "placedAt:month", aggregates: { n: "count" } }).catch((e) => e);
        expect(error).toBeInstanceOf(ValidationError);
        expect(error.fieldErrors.filter[0]).toMatch(/month bucket of "placedAt".*Filter the field itself/);
      }));

    it("rejects operators that make no sense on an aggregate, and non-numbers", () =>
      setup(async ({ order }) => {
        await expect(order.aggregate([["orders", "like", "1%"]], byCustomer)).rejects.toThrow(/operator "like" isn't supported on aggregates/);
        await expect(order.aggregate([["revenue", ">", "lots"]], byCustomer)).rejects.toThrow(/filter on aggregate "revenue"/);
        await expect(order.aggregate([["orders", "in", 3]], byCustomer)).rejects.toThrow(/needs an array/);
      }));
  });

  describe("filters that cross relations don't distort the numbers", () => {
    it("a belongsTo path filters orders by their customer", () =>
      setup(async ({ order }) => {
        expect(await order.aggregate([["customer.country", "=", "UK"]], { groupBy: "status", aggregates: { n: "count" } }))
          .toEqual([{ status: "paid", n: 3 }, { status: "refunded", n: 1 }]);
      }));

    it("a hasMany path never counts an order once per matching item", () =>
      setup(async ({ order }) => {
        // orders 1, 2 and 3 have 5 items matching skuA/skuB between them - a join would count 5 orders and sum 550
        const filter = [["items.sku", "in", ["skuA", "skuB"]]];
        expect(await order.count(filter)).toBe(3);
        expect(await order.sum("total", filter)).toBe(350);
      }));
  });

  describe("date buckets", () => {
    const bucket = async (order, spec, filter = {}) =>
      (await order.aggregate(filter, { groupBy: spec, aggregates: { n: "count" } })).map((r) => [Object.values(r)[0]?.toISOString?.() ?? null, r.n]);

    it("month", () =>
      setup(async ({ order }) => {
        expect(await bucket(order, "placedAt:month")).toEqual([
          ["2024-01-01T00:00:00.000Z", 1], ["2024-02-01T00:00:00.000Z", 3], ["2024-05-01T00:00:00.000Z", 2], [null, 1],
        ]);
      }));

    it("week starts on Monday (a Sunday belongs to the week before)", () =>
      setup(async ({ order }) => {
        expect(await bucket(order, "placedAt:week")).toEqual([
          ["2024-01-29T00:00:00.000Z", 2], // Wed Jan 31 + Thu Feb 1
          ["2024-02-12T00:00:00.000Z", 1],
          ["2024-02-19T00:00:00.000Z", 1],
          ["2024-04-29T00:00:00.000Z", 1], // Sun May 5
          ["2024-05-20T00:00:00.000Z", 1], // a Monday is its own week start
          [null, 1],
        ]);
      }));

    it("day, hour, quarter and year", () =>
      setup(async ({ order }) => {
        expect((await bucket(order, "placedAt:day")).map(([k]) => k)).toEqual([
          "2024-01-31T00:00:00.000Z", "2024-02-01T00:00:00.000Z", "2024-02-14T00:00:00.000Z", "2024-02-20T00:00:00.000Z",
          "2024-05-05T00:00:00.000Z", "2024-05-20T00:00:00.000Z", null,
        ]);
        expect((await bucket(order, "placedAt:hour")).map(([k]) => k)).toEqual([
          "2024-01-31T23:00:00.000Z", "2024-02-01T00:00:00.000Z", "2024-02-14T12:00:00.000Z", "2024-02-20T08:00:00.000Z",
          "2024-05-05T05:00:00.000Z", "2024-05-20T10:00:00.000Z", null,
        ]);
        expect(await bucket(order, "placedAt:quarter")).toEqual([["2024-01-01T00:00:00.000Z", 4], ["2024-04-01T00:00:00.000Z", 2], [null, 1]]);
        expect(await bucket(order, "placedAt:year")).toEqual([["2024-01-01T00:00:00.000Z", 6], [null, 1]]);
      }));

    it("a row just before midnight UTC stays in its UTC day and month", () =>
      setup(async ({ order }) => {
        // order 1 is placed 2024-01-31T23:30Z
        expect(await bucket(order, "placedAt:month", { id: 1 })).toEqual([["2024-01-01T00:00:00.000Z", 1]]);
        expect(await bucket(order, "placedAt:day", { id: 1 })).toEqual([["2024-01-31T00:00:00.000Z", 1]]);
      }));

    it("works on a `date` field as well as a `datetime`", () =>
      setup(async ({ order }) => {
        expect(await bucket(order, "shippedOn:month")).toEqual([["2024-02-01T00:00:00.000Z", 2], ["2024-05-01T00:00:00.000Z", 1], [null, 4]]);
      }));

    it("the object form can name the column, and a bucket combines with other keys and aggregates", () =>
      setup(async ({ order }) => {
        const rows = await order.aggregate([["status", "=", "paid"]], {
          groupBy: ["status", { field: "placedAt", bucket: "month", as: "month" }],
          aggregates: { revenue: { sum: "total" } },
          orderBy: "-revenue",
        });
        expect(rows.map((r) => [r.month?.toISOString().slice(0, 7) ?? null, r.revenue])).toEqual([
          ["2024-05", 300], ["2024-02", 250], ["2024-01", 100], [null, 10],
        ]);
      }));
  });

  describe("one statement, however much data", () => {
    it("issues exactly one SELECT, and the same number for 7 rows or 307", () =>
      setup(async ({ order, db }) => {
        const options = {
          groupBy: ["status", "placedAt:month"],
          aggregates: { n: "count", s: { sum: "total" }, a: { avg: "total" }, lo: { min: "total" }, hi: { max: "total" } },
        };
        const small = await captureQueries(db, () => order.aggregate([["customer.country", "=", "UK"]], options));
        await seedManyOrders(db, 300);
        const large = await captureQueries(db, () => order.aggregate([["customer.country", "=", "UK"]], options));

        expect(small.queries).toHaveLength(1); // not even BEGIN/COMMIT
        expect(large.queries).toHaveLength(1);
        expect(large.result.length).toBeGreaterThan(small.result.length);
      }));
  });

  describe("transactions", () => {
    it("reads inside a transaction see its uncommitted writes, and a rollback undoes them", () =>
      setup(async ({ order, api, db }) => {
        const newOrder = { id: 99, status: "paid", total: 5, qty: 1 };
        const inside = async () => {
          if (surface === "client") {
            return api.client.transaction(async (tx) => {
              await tx.models.order.create(newOrder);
              const counted = await tx.models.order.count();
              throw Object.assign(new Error("rollback"), { counted });
            });
          }
          return db.transaction(async (trx) => {
            await order.create(newOrder, { trx });
            const counted = await order.count({}, { trx });
            throw Object.assign(new Error("rollback"), { counted });
          });
        };
        const error = await inside().catch((e) => e);
        expect(error.message).toBe("rollback");
        expect(error.counted).toBe(8);
        expect(await order.count()).toBe(7);
      }));
  });
});
