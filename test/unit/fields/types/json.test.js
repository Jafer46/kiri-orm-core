import { describe, it, expect } from "vitest";
import { defineField } from "../../../../src/fields/define-field.js";
import { validateValue } from "../../../../src/fields/validate-value.js";
import { castValue } from "../../../../src/fields/cast-value.js";
import { CastError } from "../../../../src/fields/errors.js";

describe("json field type", () => {
  it("accepts an object, array, string, number, and boolean", () => {
    const field = defineField({ type: "json" });
    expect(validateValue(field, { a: 1 })).toEqual([]);
    expect(validateValue(field, [1, 2, 3])).toEqual([]);
    expect(validateValue(field, "plain string")).toEqual([]);
    expect(validateValue(field, 42)).toEqual([]);
    expect(validateValue(field, true)).toEqual([]);
  });

  it("rejects a circular object", () => {
    const field = defineField({ type: "json" });
    const circular = {};
    circular.self = circular;
    expect(validateValue(field, circular)[0]).toMatch(/not JSON-serializable/);
  });

  it("casts (passes through) a JSON-serializable object unchanged", () => {
    const field = defineField({ type: "json" });
    const value = { nested: { a: [1, 2] } };
    expect(castValue(field, value)).toEqual(value);
  });

  it("throws CastError for a circular reference", () => {
    const field = defineField({ type: "json" });
    const circular = {};
    circular.self = circular;
    expect(() => castValue(field, circular)).toThrow(CastError);
  });
});
