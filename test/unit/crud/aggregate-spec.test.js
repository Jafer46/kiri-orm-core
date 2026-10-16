import { describe, it, expect } from "vitest";
import { defineModel } from "../../../src/models/define-model.js";
import { planAggregate } from "../../../src/crud/aggregate-spec.js";
import { parseOrderBy } from "../../../src/crud/order.js";
import { ValidationError } from "../../../src/crud/errors.js";

const order = defineModel({
  name: "order",
  fields: {
    id: { type: "integer", required: true },
    status: { type: "char" },
    total: { type: "float" },
    qty: { type: "integer" },
    placedAt: { type: "datetime" },
    shippedOn: { type: "date" },
    meta: { type: "json" },
    active: { type: "boolean" },
    label: { type: "char", depends: ["status", "id"], compute: (r) => `${r.status}${r.id}` },
  },
  relations: { customer: { type: "belongsTo", model: "customer", foreignKey: "customerId" } },
});

const reject = (options, option, pattern) => {
  let error;
  try {
    planAggregate(order, options);
  } catch (err) {
    error = err;
  }
  expect(error, `expected ${JSON.stringify(options)} to be rejected`).toBeInstanceOf(ValidationError);
  expect(Object.keys(error.fieldErrors)).toEqual([option]);
  expect(error.fieldErrors[option][0]).toMatch(pattern);
};

describe("planAggregate: valid input", () => {
  it("plans keys, aggregates and a default order by the group keys", () => {
    const plan = planAggregate(order, {
      groupBy: ["status", "placedAt:month"],
      aggregates: { n: "count", revenue: { sum: "total" }, mean: { avg: "qty" }, last: { max: "placedAt" }, c: { count: "qty" }, u: { countDistinct: "status" }, all: { count: "*" } },
    });
    // (entries also carry fieldPath / hops / many / def for the SQL builder; the interesting part is these)
    const brief = (entries, props) => entries.map((entry) => Object.fromEntries(props.map((p) => [p, entry[p]])));
    expect(brief(plan.keys, ["alias", "kind", "field", "bucket"])).toEqual([
      { alias: "status", kind: "field", field: "status", bucket: undefined },
      { alias: "placedAt_month", kind: "bucket", field: "placedAt", bucket: "month" },
    ]);
    expect(brief(plan.aggregates, ["alias", "fn", "field"])).toEqual([
      { alias: "n", fn: "count", field: null },
      { alias: "revenue", fn: "sum", field: "total" },
      { alias: "mean", fn: "avg", field: "qty" },
      { alias: "last", fn: "max", field: "placedAt" },
      { alias: "c", fn: "count", field: "qty" },
      { alias: "u", fn: "countDistinct", field: "status" },
      { alias: "all", fn: "count", field: null },
    ]);
    expect(plan.keys[0]).toMatchObject({ fieldPath: "status", hops: [], def: { type: "char" } });
    expect(plan.aggregates[1]).toMatchObject({ fieldPath: "total", hops: [], many: null, def: { type: "float" } });
    expect(plan.order.map((o) => [o.entry.alias, o.direction])).toEqual([["status", "asc"], ["placedAt_month", "asc"]]);
  });

  it("accepts a single groupBy, the object form with `as`, and { count: true }", () => {
    const plan = planAggregate(order, { groupBy: { field: "shippedOn", bucket: "week", as: "wk" }, aggregates: { n: { count: true } } });
    expect(plan.keys[0]).toMatchObject({ alias: "wk", kind: "bucket", field: "shippedOn", bucket: "week" });
    expect(plan.aggregates[0]).toMatchObject({ alias: "n", fn: "count", field: null });
  });

  it("orderBy can name any result column, in any spelling", () => {
    const plan = planAggregate(order, { groupBy: "status", aggregates: { revenue: { sum: "total" } }, orderBy: ["-revenue", "status"] });
    expect(plan.order.map((o) => [o.entry.alias, o.direction])).toEqual([["revenue", "desc"], ["status", "asc"]]);
  });

  it("`as` renames a plain key (reports rely on this)", () => {
    const plan = planAggregate(order, { groupBy: { field: "status", as: "state" } });
    expect(plan.keys[0]).toMatchObject({ alias: "state", kind: "field", field: "status", fieldPath: "status" });
  });

  it("works with aggregates alone or groupBy alone", () => {
    expect(planAggregate(order, { aggregates: { n: "count" } }).keys).toEqual([]);
    expect(planAggregate(order, { groupBy: "status" }).aggregates).toEqual([]);
  });

  it("carries limit and offset", () => {
    const plan = planAggregate(order, { groupBy: "status", limit: 5, offset: 2 });
    expect([plan.limit, plan.offset]).toEqual([5, 2]);
  });
});

describe("planAggregate: groupBy errors", () => {
  it("unknown field, relation, computed field, json", () => {
    reject({ groupBy: "nope" }, "groupBy", /unknown field "nope" on model "order"\. Fields: id, status/);
    reject({ groupBy: "customer" }, "groupBy", /"customer" is a relation, not a field/);
    reject({ groupBy: "label" }, "groupBy", /computed field.*calculated in JavaScript.*status, id/);
    reject({ groupBy: "meta" }, "groupBy", /json fields can't be grouped by/);
  });

  it("bucket rules", () => {
    reject({ groupBy: "status:month" }, "groupBy", /needs a date or datetime field, but "status" is char/);
    reject({ groupBy: "placedAt:decade" }, "groupBy", /unknown bucket "decade"\. Buckets: hour, day/);
    reject({ groupBy: "placedAt:" }, "groupBy", /missing the bucket/);
    reject({ groupBy: "placedAt:day:x" }, "groupBy", /more than one ":"/);
    reject({ groupBy: { field: "status", as: "total" } }, "groupBy", /already a field/); // `as` may rename a key, but not onto a field
    reject({ groupBy: { field: "placedAt", bucket: "day", nope: 1 } }, "groupBy", /unknown groupBy option "nope"/);
  });

  it("malformed entries and duplicates", () => {
    reject({ groupBy: [5] }, "groupBy", /must be a field name/);
    reject({ groupBy: ["status", "status"] }, "groupBy", /"status" is defined more than once/);
    reject({ groupBy: ["placedAt:day", { field: "placedAt", bucket: "day" }] }, "groupBy", /"placedAt_day" is defined more than once/);
  });

  it("a bucket alias can't be a field name (a filter wouldn't know which was meant)", () => {
    reject({ groupBy: { field: "placedAt", bucket: "day", as: "status" } }, "groupBy", /already a field/);
    reject({ groupBy: { field: "placedAt", bucket: "day", as: "customer" } }, "groupBy", /already a field, computed field or relation/);
    reject({ groupBy: { field: "placedAt", bucket: "day", as: "has space" } }, "groupBy", /plain identifier/);
  });
});

describe("planAggregate: aggregates errors", () => {
  it("shape", () => {
    reject({ aggregates: [] }, "aggregates", /must be an object/);
    reject({ aggregates: { n: "sum" } }, "aggregates", /"sum" needs a field/);
    reject({ aggregates: { n: "total" } }, "aggregates", /needs a field/);
    reject({ aggregates: { n: 5 } }, "aggregates", /expected "count" or \{ fn: field \}/);
    reject({ aggregates: { n: {} } }, "aggregates", /exactly one of count, countDistinct, sum/);
    reject({ aggregates: { n: { sum: "total", avg: "total" } } }, "aggregates", /exactly one of/);
    reject({ aggregates: { n: { median: "total" } } }, "aggregates", /exactly one of/);
    reject({ aggregates: { n: { sum: true } } }, "aggregates", /expected a field name/);
  });

  it("field and type rules", () => {
    reject({ aggregates: { n: { sum: "nope" } } }, "aggregates", /unknown field "nope"/);
    reject({ aggregates: { n: { sum: "label" } } }, "aggregates", /computed field/);
    reject({ aggregates: { n: { sum: "customer" } } }, "aggregates", /is a relation/);
    reject({ aggregates: { n: { sum: "status" } } }, "aggregates", /sum needs an integer or float field, but "status" is char/);
    reject({ aggregates: { n: { avg: "placedAt" } } }, "aggregates", /avg needs an integer or float/);
    reject({ aggregates: { n: { max: "active" } } }, "aggregates", /max needs a number, date, or text field, but "active" is boolean/);
    reject({ aggregates: { n: { min: "meta" } } }, "aggregates", /min needs a number, date, or text/);
    reject({ aggregates: { n: { countDistinct: "meta" } } }, "aggregates", /can't compare json/);
  });

  it("names", () => {
    reject({ aggregates: { total: "count" } }, "aggregates", /already a field/);
    reject({ aggregates: { label: "count" } }, "aggregates", /already a field, computed field or relation/);
    reject({ aggregates: { "a-b": "count" } }, "aggregates", /plain identifier/);
    reject({ groupBy: "status", aggregates: { status: "count" } }, "aggregates", /already a field|defined more than once/);
    reject({ groupBy: { field: "placedAt", bucket: "day", as: "x" }, aggregates: { x: "count" } }, "aggregates", /defined more than once/);
  });

  it("something to compute is required", () => {
    reject({}, "aggregates", /nothing to compute/);
    reject({ aggregates: {} }, "aggregates", /nothing to compute/);
  });
});

describe("planAggregate: orderBy and paging errors", () => {
  it("orderBy must name a result column, and lists the choices", () => {
    reject({ groupBy: "status", orderBy: "total" }, "orderBy", /"total" is not a column of this result\. Sortable: status/);
    reject({ groupBy: "status", aggregates: { n: "count" }, orderBy: "label" }, "orderBy", /Sortable: status, n/);
  });

  it("orderBy shape errors reuse the ordinary messages", () => {
    reject({ groupBy: "status", orderBy: [["status", "sideways"]] }, "orderBy", /direction must be "asc" or "desc"/);
    reject({ groupBy: "status", orderBy: ["status", "-status"] }, "orderBy", /more than once/);
  });

  it("limit and offset are validated like find()'s", () => {
    expect(() => planAggregate(order, { groupBy: "status", limit: -1 })).toThrow(ValidationError);
    expect(() => planAggregate(order, { groupBy: "status", offset: 1.5 })).toThrow(ValidationError);
  });
});

describe("parseOrderBy (the shape half of normalizeOrderBy)", () => {
  const fail = (m) => {
    throw new Error(m);
  };
  it("normalizes every spelling and doesn't check field names", () => {
    expect(parseOrderBy("-a", fail)).toEqual([{ field: "a", direction: "desc" }]);
    expect(parseOrderBy(["a", "desc"], fail)).toEqual([{ field: "a", direction: "desc" }]);
    expect(parseOrderBy(["a", "-b", { field: "c", direction: "DESC" }], fail)).toEqual([
      { field: "a", direction: "asc" }, { field: "b", direction: "desc" }, { field: "c", direction: "desc" },
    ]);
    expect(parseOrderBy(undefined, fail)).toEqual([]);
  });
  it("rejects bad shapes through `fail`", () => {
    expect(() => parseOrderBy([7], fail)).toThrow(/must be a field name/);
    expect(() => parseOrderBy([["a", "up"]], fail)).toThrow(/direction/);
    expect(() => parseOrderBy(["a", "a"], fail)).toThrow(/more than once/);
    expect(() => parseOrderBy([{ direction: "asc" }], fail)).toThrow(/unknown field/);
  });
});
