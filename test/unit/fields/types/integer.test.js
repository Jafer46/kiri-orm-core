import { describe, it, expect } from "vitest";
import { defineField } from "../../../../src/fields/define-field.js";
import { validateValue } from "../../../../src/fields/validate-value.js";
import { castValue } from "../../../../src/fields/cast-value.js";
import { CastError, InvalidFieldDefinitionError } from "../../../../src/fields/errors.js";

describe("integer field type", () => {
  it("accepts a valid integer", () => {
    const field = defineField({ type: "integer" });
    expect(validateValue(field, 42)).toEqual([]);
  });

  it("rejects a float", () => {
    const field = defineField({ type: "integer" });
    expect(validateValue(field, 3.14)).toEqual([
      "expected an integer, got 3.14",
    ]);
  });

  it("rejects a numeric string (validate, not cast)", () => {
    const field = defineField({ type: "integer" });
    expect(validateValue(field, "42")).toEqual([
      'expected an integer, got "42"',
    ]);
  });

  it("enforces min/max", () => {
    const field = defineField({ type: "integer", min: 0, max: 10 });
    expect(validateValue(field, -1)).toEqual(["must be >= 0 (got -1)"]);
    expect(validateValue(field, 11)).toEqual(["must be <= 10 (got 11)"]);
    expect(validateValue(field, 5)).toEqual([]);
  });

  it("rejects min > max at definition time", () => {
    expect(() => defineField({ type: "integer", min: 10, max: 0 })).toThrow(
      InvalidFieldDefinitionError
    );
  });

  it("casts a numeric string to a number", () => {
    const field = defineField({ type: "integer" });
    expect(castValue(field, "42")).toBe(42);
  });

  it("casts a boolean to 0/1", () => {
    const field = defineField({ type: "integer" });
    expect(castValue(field, true)).toBe(1);
    expect(castValue(field, false)).toBe(0);
  });

  it("throws CastError for a non-integer string", () => {
    const field = defineField({ type: "integer" });
    expect(() => castValue(field, "3.14")).toThrow(CastError);
    expect(() => castValue(field, "abc")).toThrow(CastError);
  });

  it("throws CastError for an empty string", () => {
    const field = defineField({ type: "integer" });
    expect(() => castValue(field, "")).toThrow(CastError);
  });
});
