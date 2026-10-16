import { describe, it, expect } from "vitest";
import { defineField } from "../../../src/fields/define-field.js";
import { validateValue } from "../../../src/fields/validate-value.js";

describe("validateValue - required/empty handling", () => {
  it("returns an error for undefined when required", () => {
    const field = defineField({ type: "char", required: true });
    expect(validateValue(field, undefined)).toEqual(["value is required"]);
  });

  it("returns an error for null when required", () => {
    const field = defineField({ type: "char", required: true });
    expect(validateValue(field, null)).toEqual(["value is required"]);
  });

  it("allows undefined when not required", () => {
    const field = defineField({ type: "char" });
    expect(validateValue(field, undefined)).toEqual([]);
  });

  it("allows null when not required", () => {
    const field = defineField({ type: "char" });
    expect(validateValue(field, null)).toEqual([]);
  });

  it("delegates to the type's validate() for present values", () => {
    const field = defineField({ type: "integer" });
    expect(validateValue(field, "not a number")).toEqual([
      'expected an integer, got "not a number"',
    ]);
  });
});
