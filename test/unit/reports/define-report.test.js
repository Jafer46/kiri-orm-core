import { describe, it, expect } from "vitest";
import { defineReport, toAggregateOptions } from "../../../src/reports/define-report.js";
import { ReportDefinitionError } from "../../../src/reports/errors.js";

const base = { from: "order", fields: { status: true, n: { agg: "count" } } };
const bad = (name, definition, pattern) => {
  let error;
  try {
    defineReport(name, definition);
  } catch (err) {
    error = err;
  }
  expect(error, JSON.stringify(definition)).toBeInstanceOf(ReportDefinitionError);
  expect(error.message).toMatch(pattern);
};

describe("defineReport: normalizing fields", () => {
  const report = defineReport("sales", {
    from: "order",
    where: [["status", "=", "paid"]],
    orderBy: "-revenue",
    fields: {
      customerId: true,
      customerName: "customer.name",
      month: { from: "placedAt", bucket: "month" },
      renamed: { from: "status" },
      orders: { agg: "count" },
      revenue: { agg: "sum", of: "total" },
      distinct: { agg: "countDistinct", of: "customerId" },
      margin: { compute: (r) => r.revenue, depends: ["revenue"] },
    },
  });

  it("classifies every shape", () => {
    expect(report.fields.customerId).toEqual({ kind: "key", from: "customerId" });
    expect(report.fields.customerName).toEqual({ kind: "key", from: "customer.name" });
    expect(report.fields.month).toEqual({ kind: "key", from: "placedAt", bucket: "month" });
    expect(report.fields.renamed).toEqual({ kind: "key", from: "status" });
    expect(report.fields.orders).toEqual({ kind: "aggregate", agg: "count", of: null });
    expect(report.fields.revenue).toEqual({ kind: "aggregate", agg: "sum", of: "total" });
    expect(report.fields.margin).toMatchObject({ kind: "computed", depends: ["revenue"] });
    expect(report).toMatchObject({ name: "sales", from: "order", where: [["status", "=", "paid"]], orderBy: "-revenue" });
  });

  it("is frozen, and keeps field order", () => {
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.fields)).toBe(true);
    expect(Object.keys(report.fields)).toEqual(["customerId", "customerName", "month", "renamed", "orders", "revenue", "distinct", "margin"]);
  });

  it("defaults `where` to none", () => {
    expect(defineReport("r", base).where).toEqual([]);
  });
});

describe("toAggregateOptions", () => {
  it("turns keys into named groupBy entries and aggregates into aggregate specs; computed fields stay out", () => {
    const report = defineReport("sales", {
      from: "order",
      fields: {
        customerName: "customer.name",
        month: { from: "placedAt", bucket: "month" },
        orders: { agg: "count" },
        itemCount: { agg: "count", of: "items" },
        revenue: { agg: "sum", of: "total" },
        margin: { compute: () => 1 },
      },
    });
    expect(toAggregateOptions(report)).toEqual({
      groupBy: [{ field: "customer.name", as: "customerName" }, { field: "placedAt", as: "month", bucket: "month" }],
      aggregates: { orders: "count", itemCount: { count: "items" }, revenue: { sum: "total" } },
    });
  });
});

describe("defineReport: shape errors (found at definition time)", () => {
  it("names", () => {
    bad("not valid", base, /report name must be a plain identifier/);
    bad("1x", base, /plain identifier/);
    bad("r", { ...base, fields: { "a-b": true } }, /field name "a-b" must be a plain identifier/);
  });

  it("the definition", () => {
    bad("r", null, /expected a definition object/);
    bad("r", { ...base, extra: 1 }, /unknown option "extra"\. Valid: from, where, fields, orderBy/);
    bad("r", { fields: base.fields }, /`from` must name the model/);
    bad("r", { from: "order" }, /`fields` must be an object with at least one field/);
    bad("r", { from: "order", fields: {} }, /at least one field/);
    bad("r", { from: "order", fields: [] }, /`fields` must be an object/);
  });

  it("key fields", () => {
    bad("r", { from: "o", fields: { a: 5 } }, /field "a": expected true, a field path, or an object/);
    bad("r", { from: "o", fields: { a: { from: "" } } }, /`from` must be a field path/);
    bad("r", { from: "o", fields: { a: { from: "x", nope: 1 } } }, /field "a": unknown option "nope"\. Valid here: from, bucket/);
  });

  it("aggregate fields", () => {
    bad("r", { from: "o", fields: { a: { agg: "median", of: "x" } } }, /unknown aggregate "median"\. Use one of count, countDistinct/);
    bad("r", { from: "o", fields: { a: { agg: "sum" } } }, /"sum" needs `of`/);
    bad("r", { from: "o", fields: { a: { agg: "sum", of: 5 } } }, /`of` must be a field path/);
    bad("r", { from: "o", fields: { a: { agg: "count", of: "x", extra: 1 } } }, /unknown option "extra"/);
    expect(() => defineReport("r", { from: "o", fields: { a: { agg: "count" } } })).not.toThrow(); // count needs no `of`
  });

  it("computed fields", () => {
    bad("r", { from: "o", fields: { a: true, c: { compute: 5 } } }, /`compute` must be a function/);
    bad("r", { from: "o", fields: { a: true, c: { compute: () => 1, depends: "a" } } }, /`depends` must be an array/);
    bad("r", { from: "o", fields: { a: true, c: { compute: () => 1, depends: ["b"] } } }, /depends on "b", which isn't a field declared before it/);
    bad("r", { from: "o", fields: { c: { compute: () => 1, depends: ["a"] }, a: true } }, /Declare computed fields after the fields they read/);
    bad("r", { from: "o", fields: { c: { compute: () => 1 } } }, /at least one key or aggregate field, not only computed/);
    bad("r", { from: "o", fields: { a: true, c: { compute: () => 1, extra: 1 } } }, /unknown option "extra"\. Valid here: compute, depends/);
  });

  it("a computed field may depend on an earlier computed one", () => {
    expect(() => defineReport("r", { from: "o", fields: { a: true, c1: { compute: () => 1, depends: ["a"] }, c2: { compute: () => 2, depends: ["c1"] } } })).not.toThrow();
  });

  it("every message names the report", () => {
    bad("sales", { ...base, extra: 1 }, /^Report "sales": /);
  });
});
