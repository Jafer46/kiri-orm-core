import { describe, it, expect } from "vitest";
import { defineModel } from "../../../src/models/define-model.js";
import { planAggregate } from "../../../src/crud/aggregate-spec.js";
import { filterToAst, mentionsResultColumn, splitFilter, compileHaving } from "../../../src/crud/aggregate-filter.js";
import { defaultFieldTypeRegistry } from "../../../src/fields/default-registry.js";
import { ValidationError } from "../../../src/crud/errors.js";

const order = defineModel({
  name: "order",
  fields: {
    id: { type: "integer", required: true },
    status: { type: "char" },
    total: { type: "float" },
    placedAt: { type: "datetime" },
    shippedOn: { type: "date" },
  },
  relations: { customer: { type: "belongsTo", model: "customer", foreignKey: "customerId" } },
});

const plan = planAggregate(order, {
  groupBy: ["status", "placedAt:month"],
  aggregates: { orders: "count", revenue: { sum: "total" }, first: { min: "shippedOn" } },
});

const split = (filter) => splitFilter(order, filterToAst(filter), plan);
const leaves = (node) => (node === null ? [] : node.type === "leaf" ? [node.field] : node.children.flatMap(leaves));

describe("splitFilter", () => {
  it("sends row conditions to WHERE and aggregate conditions to HAVING", () => {
    const { where, having } = split([["status", "=", "paid"], ["revenue", ">", 100], ["total", ">", 5], ["orders", "<", 9]]);
    expect(leaves(where)).toEqual(["status", "total"]);
    expect(leaves(having)).toEqual(["revenue", "orders"]);
  });

  it("an empty filter has no HAVING, and an empty WHERE", () => {
    const { where, having } = split([]);
    expect(where).toEqual({ type: "and", children: [] });
    expect(having).toBeNull();
  });

  it("a filter that only names aggregates has an empty WHERE", () => {
    const { where, having } = split([["revenue", ">", 1]]);
    expect(where.children).toEqual([]);
    expect(leaves(having)).toEqual(["revenue"]);
  });

  it("explicit & is flattened, so each side is sorted on its own", () => {
    const { where, having } = split(["&", ["status", "=", "paid"], ["revenue", ">", 1]]);
    expect(leaves(where)).toEqual(["status"]);
    expect(leaves(having)).toEqual(["revenue"]);
  });

  it("an OR or NOT entirely on one side is kept whole", () => {
    const { where, having } = split(["&", ["|", ["status", "=", "a"], ["status", "=", "b"]], ["!", ["revenue", "<", 5]]]);
    expect(where.children[0].type).toBe("or");
    expect(having.children[0].type).toBe("not");
  });

  it("relation paths are row conditions (they become the usual subquery)", () => {
    expect(leaves(split([["customer.country", "=", "UK"]]).where)).toEqual(["customer.country"]);
  });

  it("refuses an OR/NOT that mixes both, naming the aggregates", () => {
    for (const filter of [["|", ["status", "=", "a"], ["revenue", ">", 1]], ["!", ["&", ["status", "=", "a"], ["orders", ">", 1]]]]) {
      let error;
      try {
        split(filter);
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.fieldErrors.filter[0]).toMatch(/mixes fields of the rows with aggregates \(orders, revenue, first\)/);
    }
  });

  it("refuses a bucket alias, and says which field to filter instead", () => {
    expect(() => split([["placedAt_month", "=", new Date()]])).toThrow(/month bucket of "placedAt".*\["placedAt", ">=", someDate\]/);
  });
});

describe("filterToAst / mentionsResultColumn", () => {
  it("turns a plain object into equality terms", () => {
    expect(leaves(filterToAst({ a: 1, b: 2 }))).toEqual(["a", "b"]);
    expect(filterToAst({ a: 1 })).toEqual({ type: "leaf", field: "a", op: "=", value: 1 });
    expect(filterToAst(undefined)).toEqual({ type: "and", children: [] });
  });

  it("only a plain object naming an aggregate or bucket needs the domain route", () => {
    expect(mentionsResultColumn({ status: "paid" }, plan)).toBe(false);
    expect(mentionsResultColumn({ status: "paid", orders: 1 }, plan)).toBe(true);
    expect(mentionsResultColumn({ placedAt_month: 1 }, plan)).toBe(true);
    expect(mentionsResultColumn([["orders", "=", 1]], plan)).toBe(false); // arrays go through splitFilter anyway
  });
});

describe("compileHaving", () => {
  const expressionFor = (entry) => ({ sql: `${entry.fn}(?)`, bindings: [entry.field ?? "*"] });
  const compile = (filter) => {
    const { having } = split(filter);
    return compileHaving(order, plan, having, expressionFor, defaultFieldTypeRegistry);
  };

  it("compiles comparisons with bound, cast values", () => {
    expect(compile([["revenue", ">=", "10.5"]])).toEqual({ sql: "(sum(?) >= ?)", bindings: ["total", 10.5] });
    expect(compile([["orders", "!=", 3]])).toEqual({ sql: "(count(?) <> ?)", bindings: ["*", 3] });
  });

  it("min/max values are cast with the column's own type", () => {
    const { bindings } = compile([["first", ">", "2024-02-10T00:00:00Z"]]);
    expect(bindings[1]).toBeInstanceOf(Date);
  });

  it("handles in / not in, including the empty list", () => {
    expect(compile([["orders", "in", [1, 2]]]).sql).toBe("(count(?) IN (?, ?))");
    expect(compile([["orders", "not in", [1]]]).sql).toBe("(count(?) NOT IN (?))");
    expect(compile([["orders", "in", []]]).sql).toBe("(1 = 0)");
    expect(compile([["orders", "not in", []]]).sql).toBe("(1 = 1)");
  });

  it("compares to null with IS [NOT] NULL", () => {
    expect(compile([["first", "=", null]]).sql).toBe("(min(?) IS NULL)");
    expect(compile([["first", "!=", null]]).sql).toBe("(min(?) IS NOT NULL)");
    expect(() => compile([["first", ">", null]])).toThrow(/can't compare to null/);
  });

  it("nests OR and NOT with parentheses and keeps binding order", () => {
    const { sql, bindings } = compile(["|", ["orders", "=", 1], ["!", ["revenue", ">", 5]]]);
    expect(sql).toBe("((count(?) = ? OR NOT (sum(?) > ?)))");
    expect(bindings).toEqual(["*", 1, "total", 5]);
  });

  it("rejects what an aggregate can't be compared with", () => {
    expect(() => compile([["orders", "like", "1%"]])).toThrow(/isn't supported on aggregates/);
    expect(() => compile([["revenue", ">", "lots"]])).toThrow(/filter on aggregate "revenue"/);
    expect(() => compile([["orders", "in", 3]])).toThrow(/needs an array/);
  });
});
