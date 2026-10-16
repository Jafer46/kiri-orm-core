import { describe, it, expect } from "vitest";
import { eachIsolatedDialect } from "../helpers/isolated-dialects.js";
import { captureQueries } from "../helpers/sql-capture.js";
import { makeApi, SURFACES } from "../helpers/select-fixture.js";
import { AGG_MODELS, seedAgg, seedManyOrders } from "../helpers/aggregate-fixture.js";
import { ValidationError } from "../../src/crud/errors.js";

const d = (iso) => new Date(iso);
const selects = (queries) => queries.filter(({ sql }) => /^\s*select/i.test(sql));
const MATRIX = eachIsolatedDialect().flatMap((dialect) =>
  SURFACES.map((surface) => ({ name: `${dialect.name} / ${surface}`, surface, run: dialect.run }))
);

describe.each(MATRIX)("aggregate across relations - $name", ({ surface, run }) => {
  const setup = (fn) =>
    run(async (db) => {
      const api = await makeApi(surface, db, AGG_MODELS);
      await seedAgg(db);
      return fn({ order: api.handle("order"), api, db });
    });
  const rowsOf = (rows, ...keys) => rows.map((r) => keys.map((k) => r[k]));

  describe("to-one paths: join freely (a row has at most one match)", () => {
    it("groups by a field of a related model", () =>
      setup(async ({ order }) => {
        const rows = await order.aggregate({}, { groupBy: "customer.country", aggregates: { n: "count", revenue: { sum: "total" } } });
        expect(rowsOf(rows, "customer_country", "n", "revenue")).toEqual([["UK", 4, 370], ["US", 2, 375], [null, 1, 10]]);
      }));

    it("follows several to-one hops", () =>
      setup(async ({ order }) => {
        const rows = await order.aggregate({}, { groupBy: ["customer.company.name"], aggregates: { n: "count" } });
        expect(rowsOf(rows, "customer_company_name", "n")).toEqual([["Acme", 4], ["Globex", 2], [null, 1]]);
      }));

    it("two keys through the same relation share one join", () =>
      setup(async ({ order, db }) => {
        const { queries, result } = await captureQueries(db, () =>
          order.aggregate({}, { groupBy: ["customer.country", "customer.vip"], aggregates: { n: "count" } })
        );
        expect(rowsOf(result, "customer_country", "customer_vip", "n")).toEqual([
          ["UK", false, 2], ["UK", true, 2], ["US", true, 2], [null, null, 1],
        ]);
        expect(selects(queries)[0].sql.match(/left join/gi)).toHaveLength(1);
      }));

    it("aggregates a related field, once per row of the base model", () =>
      setup(async ({ order }) => {
        const [row] = await order.aggregate({}, {
          aggregates: { creditSum: { sum: "customer.credit" }, newest: { max: "customer.createdAt" }, oldest: { min: "customer.createdAt" }, withCustomer: { count: "customer" } },
        });
        // each order contributes its customer's credit: 2x100 + 2x50 + 2x25 (order 5 has no customer)
        expect(row.creditSum).toBe(350);
        expect(row.newest).toEqual(d("2024-01-20T10:00:00Z"));
        expect(row.oldest).toEqual(d("2023-12-15T10:00:00Z"));
        expect(row.withCustomer).toBe(6);
      }));

    it("buckets a date on a related model", () =>
      setup(async ({ order }) => {
        const rows = await order.aggregate({}, { groupBy: "customer.createdAt:month", aggregates: { n: "count" } });
        expect(rows.map((r) => [r.customer_createdAt_month?.toISOString().slice(0, 7) ?? null, r.n])).toEqual([["2023-12", 2], ["2024-01", 4], [null, 1]]);
      }));

    it("the alias can be chosen, and a key can be filtered by it", () =>
      setup(async ({ order }) => {
        const options = { groupBy: { field: "customer.country", as: "country" }, aggregates: { n: "count" } };
        expect(await order.aggregate([["country", "=", "UK"]], options)).toEqual([{ country: "UK", n: 4 }]);
        expect(await order.aggregate({ country: "US" }, options)).toEqual([{ country: "US", n: 2 }]);
        expect(await order.aggregate({}, options)).toHaveLength(3);
      }));

    it("a plain field can be renamed too", () =>
      setup(async ({ order }) => {
        const rows = await order.aggregate([["state", "=", "paid"]], { groupBy: { field: "status", as: "state" }, aggregates: { n: "count" } });
        expect(rows).toEqual([{ state: "paid", n: 5 }]);
      }));
  });

  describe("to-many paths: one row per parent, so nothing is counted twice", () => {
    const itemAggregates = {
      orders: "count", revenue: { sum: "total" },
      itemsTotal: { sum: "items.amount" }, itemCount: { count: "items" }, avgItem: { avg: "items.amount" },
      biggest: { max: "items.amount" }, smallest: { min: "items.amount" }, units: { sum: "items.qty" },
    };

    it("sums a child field without inflating the parent's own totals", () =>
      setup(async ({ order }) => {
        const rows = await order.aggregate({}, { groupBy: "status", aggregates: itemAggregates });
        expect(rows).toEqual([
          { status: "cancelled", orders: 1, revenue: 75, itemsTotal: null, itemCount: 0, avgItem: null, biggest: null, smallest: null, units: null },
          // joining orders to items would make this revenue 960 (orders 1 and 3 have two items each)
          { status: "paid", orders: 5, revenue: 660, itemsTotal: 650, itemCount: 6, avgItem: expect.closeTo(650 / 6, 6), biggest: 300, smallest: 40, units: 13 },
          { status: "refunded", orders: 1, revenue: 20, itemsTotal: null, itemCount: 0, avgItem: null, biggest: null, smallest: null, units: null },
        ]);
      }));

    it("avg is total / count across all children, not an average of per-parent averages", () =>
      setup(async ({ order }) => {
        const [row] = await order.aggregate([["status", "=", "paid"]], { aggregates: { avgItem: { avg: "items.amount" } } });
        // per-order averages are 50, 50, 100, 300 (mean 125); over the six items it is 650 / 6
        expect(row.avgItem).toBeCloseTo(108.3333333, 5);
        expect(row.avgItem).not.toBeCloseTo(125, 1);
      }));

    it("works with no groupBy at all", () =>
      setup(async ({ order }) => {
        expect(await order.aggregate({}, { aggregates: { orders: "count", revenue: { sum: "total" }, itemsTotal: { sum: "items.amount" } } }))
          .toEqual([{ orders: 7, revenue: 755, itemsTotal: 650 }]);
      }));

    it("has numbers as numbers on both databases", () =>
      setup(async ({ order }) => {
        const [row] = await order.aggregate({}, { aggregates: itemAggregates });
        for (const value of Object.values(row)) expect(typeof value).toBe("number");
      }));

    it("combines with a to-one group key", () =>
      setup(async ({ order }) => {
        const rows = await order.aggregate({}, { groupBy: "customer.country", aggregates: { orders: "count", itemsTotal: { sum: "items.amount" }, itemCount: { count: "items" } } });
        expect(rowsOf(rows, "customer_country", "orders", "itemsTotal", "itemCount")).toEqual([["UK", 4, 350, 5], ["US", 2, 300, 1], [null, 1, null, 0]]);
      }));

    it("two different to-many relations at once don't multiply each other", () =>
      setup(async ({ order }) => {
        // order 1 has 2 items AND 2 tags: a join through both would turn its 100 into 4 rows
        const rows = await order.aggregate([["status", "=", "paid"]], {
          groupBy: "status",
          aggregates: { orders: "count", revenue: { sum: "total" }, itemsTotal: { sum: "items.amount" }, tagCount: { count: "tags" } },
        });
        expect(rows).toEqual([{ status: "paid", orders: 5, revenue: 660, itemsTotal: 650, tagCount: 4 }]);
      }));

    it("belongsToMany: counts, and min/max over the related field", () =>
      setup(async ({ order }) => {
        const rows = await order.aggregate({}, { groupBy: "status", aggregates: { tagCount: { count: "tags" }, first: { min: "tags.name" }, last: { max: "tags.name" } } });
        expect(rows).toEqual([
          { status: "cancelled", tagCount: 0, first: null, last: null },
          { status: "paid", tagCount: 4, first: "alpha", last: "beta" },
          { status: "refunded", tagCount: 0, first: null, last: null },
        ]);
      }));

    it("follows a to-one hop inside the to-many relation", () =>
      setup(async ({ order }) => {
        const [row] = await order.aggregate([["status", "=", "paid"]], {
          aggregates: { priciest: { max: "items.product.price" }, cheapest: { min: "items.product.price" }, listTotal: { sum: "items.product.price" } },
        });
        // per order: 35 (10+25), 10, 35, 40
        expect(row).toEqual({ priciest: 40, cheapest: 10, listTotal: 120 });
      }));

    it("a null group key and a parent without children are both kept", () =>
      setup(async ({ order }) => {
        const rows = await order.aggregate({}, { groupBy: "customerId", aggregates: { orders: "count", itemCount: { count: "items" } }, orderBy: "customerId" });
        expect(rowsOf(rows, "customerId", "orders", "itemCount")).toEqual([[1, 2, 3], [2, 2, 2], [3, 2, 1], [null, 1, 0]]);
      }));
  });

  describe("filtering on what was aggregated", () => {
    it("HAVING works on a to-many aggregate; row conditions still run first", () =>
      setup(async ({ order }) => {
        const options = { groupBy: "customerId", aggregates: { itemsTotal: { sum: "items.amount" }, itemCount: { count: "items" } } };
        const ids = async (filter) => (await order.aggregate(filter, options)).map((r) => r.customerId);
        expect(await ids([["itemsTotal", ">", 100]])).toEqual([1, 2, 3]);
        expect(await ids([["itemsTotal", ">", 250]])).toEqual([3]);
        expect(await ids([["itemCount", "=", 0]])).toEqual([null]);
        expect(await ids([["status", "=", "paid"], ["itemsTotal", ">", 100]])).toEqual([1, 2, 3]); // paid only: 150, 200, 300
        expect(await ids([["status", "=", "cancelled"], ["itemsTotal", ">", 0]])).toEqual([]);
      }));

    it("a relation filter combines with relation aggregates", () =>
      setup(async ({ order }) => {
        const [row] = await order.aggregate([["customer.country", "=", "UK"]], { aggregates: { orders: "count", itemsTotal: { sum: "items.amount" } } });
        expect(row).toEqual({ orders: 4, itemsTotal: 350 });
      }));

    it("can order by a to-many aggregate", () =>
      setup(async ({ order }) => {
        const rows = await order.aggregate({}, { groupBy: "customerId", aggregates: { itemsTotal: { sum: "items.amount" } }, orderBy: "-itemsTotal", limit: 2 });
        expect(rowsOf(rows, "customerId", "itemsTotal")).toEqual([[3, 300], [2, 200]]);
      }));
  });

  describe("rejected before any SQL is sent", () => {
    it("explains why a to-many path can't be grouped by, and what to do instead", () =>
      setup(async ({ order, db }) => {
        const { queries } = await captureQueries(db, async () => {
          const reject = async (options, option, pattern) => {
            const error = await order.aggregate({}, options).catch((e) => e);
            expect(error, JSON.stringify(options)).toBeInstanceOf(ValidationError);
            expect(error.fieldErrors[option][0]).toMatch(pattern);
          };
          await reject({ groupBy: "items.sku" }, "groupBy", /"items" is a hasMany \(to-many\) relation.*can't be grouped by.*start from "item"/);
          await reject({ groupBy: "tags.name" }, "groupBy", /belongsToMany \(to-many\)/);
          await reject({ groupBy: "firstItem.sku" }, "groupBy", /hasOne \(to-many\)/); // a hasOne can have two rows, so it isn't trusted as to-one
          await reject({ aggregates: { n: { countDistinct: "items.sku" } } }, "aggregates", /countDistinct across the to-many relation "items" isn't supported/);
          await reject({ aggregates: { n: { sum: "items.order.tags.id" } } }, "aggregates", /more than one to-many relation/);
          await reject({ aggregates: { n: { sum: "customer.orders.total" } } }, "aggregates", /after a to-one hop \("customer"\) isn't supported/);
          await reject({ aggregates: { n: { sum: "customer.name" } } }, "aggregates", /sum needs an integer or float field, but "customer.name" is char/);
          await reject({ aggregates: { n: { sum: "items" } } }, "aggregates", /"items" is a relation, not a field/);
          await reject({ aggregates: { n: { sum: "customer.nope" } } }, "aggregates", /unknown field "nope" on model "customer"\. Fields: id, name.*Relations: company, orders/);
          await reject({ aggregates: { n: { sum: "status.x" } } }, "aggregates", /"status" is a field of "order", not a relation/);
          await reject({ groupBy: "customer..country" }, "groupBy", /not a valid path/);
          await reject({ groupBy: "customer.vip:month" }, "groupBy", /a bucket needs a date or datetime field/);
        });
        expect(queries).toHaveLength(0);
      }));
  });

  describe("one statement", () => {
    it("a query touching to-one joins and two to-many relations is still a single SELECT, however much data", () =>
      setup(async ({ order, db }) => {
        const options = {
          groupBy: ["customer.country", "customer.company.name"],
          aggregates: { n: "count", itemsTotal: { sum: "items.amount" }, tagCount: { count: "tags" }, credit: { max: "customer.credit" } },
        };
        const small = await captureQueries(db, () => order.aggregate({}, options));
        await seedManyOrders(db, 300);
        const large = await captureQueries(db, () => order.aggregate({}, options));
        expect(small.queries).toHaveLength(1);
        expect(large.queries).toHaveLength(1);
        expect(large.result.reduce((sum, r) => sum + r.n, 0)).toBe(307);
      }));
  });
});
