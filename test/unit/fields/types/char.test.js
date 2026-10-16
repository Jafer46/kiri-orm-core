import { describe, it, expect } from "vitest";
import { defineField } from "../../../../src/fields/define-field.js";
import { validateValue } from "../../../../src/fields/validate-value.js";
import { castValue } from "../../../../src/fields/cast-value.js";
import { CastError, InvalidFieldDefinitionError } from "../../../../src/fields/errors.js";

describe("char field type", () => {
  it("accepts a valid string within maxLength", () => {
    const field = defineField({ type: "char", maxLength: 10 });
    expect(validateValue(field, "hello")).toEqual([]);
  });

  it("rejects a non-string value", () => {
    const field = defineField({ type: "char" });
    expect(validateValue(field, 123)).toEqual(["expected a string, got number"]);
  });

  it("rejects a string exceeding maxLength", () => {
    const field = defineField({ type: "char", maxLength: 3 });
    expect(validateValue(field, "toolong")).toEqual([
      "must be at most 3 characters (got 7)",
    ]);
  });

  it("rejects a string shorter than minLength", () => {
    const field = defineField({ type: "char", minLength: 5 });
    expect(validateValue(field, "hi")).toEqual([
      "must be at least 5 characters (got 2)",
    ]);
  });

  it("defaults maxLength to 255 when not set", () => {
    const field = defineField({ type: "char" });
    const longString = "a".repeat(300);
    expect(validateValue(field, longString)).toEqual([
      "must be at most 255 characters (got 300)",
    ]);
  });

  it("rejects a negative maxLength at definition time", () => {
    expect(() => defineField({ type: "char", maxLength: -5 })).toThrow(
      InvalidFieldDefinitionError
    );
  });

  it("rejects minLength greater than maxLength at definition time", () => {
    expect(() =>
      defineField({ type: "char", minLength: 10, maxLength: 5 })
    ).toThrow(InvalidFieldDefinitionError);
  });

  it("casts a string unchanged", () => {
    const field = defineField({ type: "char" });
    expect(castValue(field, "hello")).toBe("hello");
  });

  it("casts a number to its string form", () => {
    const field = defineField({ type: "char" });
    expect(castValue(field, 42)).toBe("42");
  });

  it("casts a boolean to its string form", () => {
    const field = defineField({ type: "char" });
    expect(castValue(field, true)).toBe("true");
  });

  it("throws CastError for an object value", () => {
    const field = defineField({ type: "char" });
    expect(() => castValue(field, { a: 1 })).toThrow(CastError);
  });
});
