import { describe, it, expect } from "vitest";
import { defineField } from "../../../../src/fields/define-field.js";
import { validateValue } from "../../../../src/fields/validate-value.js";
import { castValue } from "../../../../src/fields/cast-value.js";
import { CastError } from "../../../../src/fields/errors.js";

describe("boolean field type", () => {
  it("accepts true and false", () => {
    const field = defineField({ type: "boolean" });
    expect(validateValue(field, true)).toEqual([]);
    expect(validateValue(field, false)).toEqual([]);
  });

  it("rejects a non-boolean value (validate, not cast)", () => {
    const field = defineField({ type: "boolean" });
    expect(validateValue(field, "true")).toEqual([
      "expected a boolean, got string",
    ]);
  });

  it("casts 1/0 to true/false", () => {
    const field = defineField({ type: "boolean" });
    expect(castValue(field, 1)).toBe(true);
    expect(castValue(field, 0)).toBe(false);
  });

  it("casts common truthy/falsy strings", () => {
    const field = defineField({ type: "boolean" });
    expect(castValue(field, "true")).toBe(true);
    expect(castValue(field, "YES")).toBe(true);
    expect(castValue(field, "false")).toBe(false);
    expect(castValue(field, "no")).toBe(false);
  });

  it("throws CastError for an unrecognized string", () => {
    const field = defineField({ type: "boolean" });
    expect(() => castValue(field, "maybe")).toThrow(CastError);
  });

  it("throws CastError for a numeric value other than 0/1", () => {
    const field = defineField({ type: "boolean" });
    expect(() => castValue(field, 2)).toThrow(CastError);
  });
});
