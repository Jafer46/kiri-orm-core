import { describe, it, expect } from "vitest";
import { defineField } from "../../../../src/fields/define-field.js";
import { validateValue } from "../../../../src/fields/validate-value.js";
import { castValue } from "../../../../src/fields/cast-value.js";

describe("text field type", () => {
  it("accepts a long string with no maxLength set", () => {
    const field = defineField({ type: "text" });
    expect(validateValue(field, "a".repeat(10000))).toEqual([]);
  });

  it("rejects a non-string value", () => {
    const field = defineField({ type: "text" });
    expect(validateValue(field, false)).toEqual(["expected a string, got boolean"]);
  });

  it("enforces an explicit maxLength when set", () => {
    const field = defineField({ type: "text", maxLength: 5 });
    expect(validateValue(field, "toolong")).toEqual([
      "must be at most 5 characters (got 7)",
    ]);
  });

  it("casts numbers and booleans to string like char does", () => {
    const field = defineField({ type: "text" });
    expect(castValue(field, 7)).toBe("7");
    expect(castValue(field, false)).toBe("false");
  });
});
