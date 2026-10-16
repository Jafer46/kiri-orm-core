import { describe, it, expect } from "vitest";
import { defineModel } from "../../../src/models/define-model.js";
import { normalizeOrderBy, validatePaging, applyOrderAndPaging } from "../../../src/crud/order.js";
import { ValidationError } from "../../../src/crud/errors.js";

const model = defineModel({
  name: "post",
  fields: { id: { type: "integer", required: true }, title: { type: "char" }, views: { type: "integer" } },
});

describe("normalizeOrderBy", () => {
  it("undefined/null means no ordering", () => {
    expect(normalizeOrderBy(model, undefined)).toEqual([]);
    expect(normalizeOrderBy(model, null)).toEqual([]);
  });

  it("a bare field name is ascending", () => {
    expect(normalizeOrderBy(model, "title")).toEqual([{ field: "title", direction: "asc" }]);
  });

  it("a leading - is descending", () => {
    expect(normalizeOrderBy(model, "-title")).toEqual([{ field: "title", direction: "desc" }]);
  });

  it("an array of field names sorts by each in order", () => {
    expect(normalizeOrderBy(model, ["title", "-views"])).toEqual([
      { field: "title", direction: "asc" },
      { field: "views", direction: "desc" },
    ]);
  });

  it("a [field, direction] pair is accepted, and isn't mistaken for two field names", () => {
    expect(normalizeOrderBy(model, ["title", "desc"])).toEqual([{ field: "title", direction: "desc" }]);
    expect(normalizeOrderBy(model, [["title", "desc"]])).toEqual([{ field: "title", direction: "desc" }]);
  });

  it("a { field, direction } object is accepted, bare or inside an array", () => {
    expect(normalizeOrderBy(model, { field: "views", direction: "desc" })).toEqual([
      { field: "views", direction: "desc" },
    ]);
    expect(normalizeOrderBy(model, [{ field: "views" }])).toEqual([{ field: "views", direction: "asc" }]);
  });

  it("direction is case-insensitive", () => {
    expect(normalizeOrderBy(model, { field: "views", direction: "DESC" })).toEqual([
      { field: "views", direction: "desc" },
    ]);
  });

  it("rejects an unknown field", () => {
    expect(() => normalizeOrderBy(model, "bogus")).toThrow(ValidationError);
    expect(() => normalizeOrderBy(model, "bogus")).toThrow(/unknown field/);
  });

  it("rejects a bad direction", () => {
    expect(() => normalizeOrderBy(model, { field: "title", direction: "sideways" })).toThrow(/asc.*or.*desc/i);
  });

  it("rejects the same field listed twice", () => {
    expect(() => normalizeOrderBy(model, ["title", "title"])).toThrow(/more than once/);
  });
});

describe("validatePaging", () => {
  it("accepts undefined, and non-negative integers", () => {
    expect(() => validatePaging(model, {})).not.toThrow();
    expect(() => validatePaging(model, { limit: 0, offset: 0 })).not.toThrow();
    expect(() => validatePaging(model, { limit: 20, offset: 40 })).not.toThrow();
  });

  it("rejects negative or non-integer limit/offset", () => {
    expect(() => validatePaging(model, { limit: -1 })).toThrow(/non-negative integer/);
    expect(() => validatePaging(model, { offset: 1.5 })).toThrow(/non-negative integer/);
    expect(() => validatePaging(model, { limit: "10" })).toThrow(/non-negative integer/);
  });
});

function fakeQuery() {
  const calls = [];
  const qb = {
    orderBy: (col, dir) => {
      calls.push(["orderBy", col, dir]);
      return qb;
    },
    limit: (n) => {
      calls.push(["limit", n]);
      return qb;
    },
    offset: (n) => {
      calls.push(["offset", n]);
      return qb;
    },
  };
  return { qb, calls };
}

describe("applyOrderAndPaging", () => {
  it("with no options at all, touches nothing - exactly the old unordered find()", () => {
    const { qb, calls } = fakeQuery();
    applyOrderAndPaging(qb, model, {});
    expect(calls).toEqual([]);
  });

  it("a bare limit with no orderBy/offset stays unordered, unchanged from before pagination existed", () => {
    const { qb, calls } = fakeQuery();
    applyOrderAndPaging(qb, model, { limit: 10 });
    expect(calls).toEqual([["limit", 10]]);
  });

  it("orderBy is applied before limit", () => {
    const { qb, calls } = fakeQuery();
    applyOrderAndPaging(qb, model, { orderBy: "title", limit: 5 });
    expect(calls).toEqual([
      ["orderBy", model.columns.title, "asc"],
      ["orderBy", model.columns.id, "asc"], // primary key appended for a stable order
      ["limit", 5],
    ]);
  });

  it("offset without orderBy still gets the primary key appended, for a stable page boundary", () => {
    const { qb, calls } = fakeQuery();
    applyOrderAndPaging(qb, model, { offset: 20, limit: 10 });
    expect(calls).toEqual([
      ["orderBy", model.columns.id, "asc"],
      ["limit", 10],
      ["offset", 20],
    ]);
  });

  it("doesn't duplicate the primary key if it's already in orderBy", () => {
    const { qb, calls } = fakeQuery();
    applyOrderAndPaging(qb, model, { orderBy: "-id", offset: 0 });
    expect(calls).toEqual([["orderBy", model.columns.id, "desc"]]);
  });

  it("several sort keys are applied in priority order, then the tie-breaker", () => {
    const { qb, calls } = fakeQuery();
    applyOrderAndPaging(qb, model, { orderBy: [["views", "desc"], "title"] });
    expect(calls).toEqual([
      ["orderBy", model.columns.views, "desc"],
      ["orderBy", model.columns.title, "asc"],
      ["orderBy", model.columns.id, "asc"],
    ]);
  });

  it("propagates orderBy/paging validation errors", () => {
    const { qb } = fakeQuery();
    expect(() => applyOrderAndPaging(qb, model, { orderBy: "bogus" })).toThrow(/unknown field/);
    expect(() => applyOrderAndPaging(qb, model, { limit: -1 })).toThrow(/non-negative integer/);
  });
});
