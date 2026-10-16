import { describe, it, expect } from "vitest";
import { sqliteConnection } from "../../helpers/dialects.js";
import { defineModel } from "../../../src/models/define-model.js";
import { compileDomain } from "../../../src/domain/compile.js";
import { DomainValidationError } from "../../../src/domain/errors.js";

const model = defineModel({
  name: "invoice",
  fields: {
    id: { type: "integer", required: true },
    status: { type: "enum", values: ["draft", "sent", "paid"] },
    amount: { type: "float" },
    title: { type: "char" },
    customerId: { type: "integer" },
  },
});

function sql(domain) {
  const db = sqliteConnection();
  const query = db("invoice").where(compileDomain(model, domain));
  const str = query.toString();
  db.destroy();
  return str;
}

// Every expected string below was captured from a real, executed Knex
// query (not hand-guessed), then verified by eye to have correct
// semantics before being locked in here. The extra parentheses around
// single conditions are harmless - Knex wraps every grouped
// where-callback in parens regardless of how many conditions it holds.
describe("compileDomain - SQL generation (verified snapshots)", () => {
  it("compiles a single equality leaf", () => {
    expect(sql([["status", "=", "paid"]])).toBe(
      "select * from `invoice` where (`status` = 'paid')"
    );
  });

  it("compiles an implicit top-level AND of two leaves", () => {
    expect(
      sql([
        ["status", "=", "paid"],
        ["amount", ">", 100],
      ])
    ).toBe("select * from `invoice` where (((`status` = 'paid') and (`amount` > 100)))");
  });

  it("compiles an explicit '|' as OR", () => {
    expect(sql(["|", ["status", "=", "draft"], ["status", "=", "sent"]])).toBe(
      "select * from `invoice` where (((`status` = 'draft') or (`status` = 'sent')))"
    );
  });

  it("compiles nested groups: OR of an AND and a leaf", () => {
    const domain = [
      "|",
      ["&", ["status", "=", "paid"], ["amount", ">", 100]],
      ["status", "=", "draft"],
    ];
    expect(sql(domain)).toBe(
      "select * from `invoice` where (((((`status` = 'paid') and (`amount` > 100))) or (`status` = 'draft')))"
    );
  });

  it("compiles '!' as NOT", () => {
    expect(sql(["!", ["status", "=", "draft"]])).toBe(
      "select * from `invoice` where (not (`status` = 'draft'))"
    );
  });

  it("compiles 'in' to whereIn", () => {
    expect(sql([["status", "in", ["draft", "sent"]]])).toBe(
      "select * from `invoice` where (`status` in ('draft', 'sent'))"
    );
  });

  it("compiles '=' with a null value to IS NULL", () => {
    expect(sql([["customerId", "=", null]])).toBe(
      "select * from `invoice` where (`customer_id` is null)"
    );
  });

  it("compiles '!=' with a null value to IS NOT NULL", () => {
    expect(sql([["customerId", "!=", null]])).toBe(
      "select * from `invoice` where (`customer_id` is not null)"
    );
  });

  it("resolves the leaf field's column name via the model, not the field name", () => {
    expect(sql([["customerId", "=", 1]])).toContain("`customer_id`");
  });

  it("casts a leaf value through the field's type (numeric string -> number)", () => {
    expect(sql([["amount", ">", "100"]])).toBe("select * from `invoice` where (`amount` > 100)");
  });

  it("an empty domain compiles to a query with no WHERE restriction", () => {
    const db = sqliteConnection();
    const str = db("invoice").where(compileDomain(model, [])).toString();
    db.destroy();
    expect(str).toBe("select * from `invoice`");
  });
});

describe("compileDomain - validation", () => {
  it("throws DomainValidationError for an unknown field name (compile time, before any query runs)", () => {
    expect(() => compileDomain(model, [["typoField", "=", 1]])).toThrow(DomainValidationError);
  });

  it("includes the model's known field names in the error message", () => {
    expect(() => compileDomain(model, [["typoField", "=", 1]])).toThrow(/status/);
  });

  it("throws DomainValidationError when 'in' is given a non-array value", () => {
    expect(() => compileDomain(model, [["status", "in", "draft"]])).toThrow(DomainValidationError);
  });
});
