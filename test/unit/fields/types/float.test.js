import { describe, it, expect } from "vitest";
import { defineField } from "../../../../src/fields/define-field.js";
import { validateValue } from "../../../../src/fields/validate-value.js";
import { castValue } from "../../../../src/fields/cast-value.js";
import { CastError } from "../../../../src/fields/errors.js";

describe("float field type", () => {
  it("accepts an integer and a decimal", () => {
    const field = defineField({ type: "float" });
    expect(validateValue(field, 42)).toEqual([]);
    expect(validateValue(field, 3.14)).toEqual([]);
  });

  it("rejects NaN and Infinity", () => {
    const field = defineField({ type: "float" });
    expect(validateValue(field, NaN)[0]).toMatch(/expected a finite number/);
    expect(validateValue(field, Infinity)[0]).toMatch(/expected a finite number/);
  });

  it("enforces min/max", () => {
    const field = defineField({ type: "float", min: 0, max: 1 });
    expect(validateValue(field, -0.1)).toEqual(["must be >= 0 (got -0.1)"]);
    expect(validateValue(field, 1.5)).toEqual(["must be <= 1 (got 1.5)"]);
  });

  it("casts a numeric string to a number", () => {
    const field = defineField({ type: "float" });
    expect(castValue(field, "3.14")).toBe(3.14);
  });

  it("throws CastError for a non-numeric string", () => {
    const field = defineField({ type: "float" });
    expect(() => castValue(field, "abc")).toThrow(CastError);
  });
});
