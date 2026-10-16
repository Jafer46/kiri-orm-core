import { describe, it, expect } from "vitest";
import { defineField } from "../../../../src/fields/define-field.js";
import { validateValue } from "../../../../src/fields/validate-value.js";
import { castValue } from "../../../../src/fields/cast-value.js";
import { CastError, InvalidFieldDefinitionError } from "../../../../src/fields/errors.js";

describe("enum field type", () => {
  it("accepts a value from the values list", () => {
    const field = defineField({ type: "enum", values: ["draft", "sent", "paid"] });
    expect(validateValue(field, "sent")).toEqual([]);
  });

  it("rejects a value not in the values list", () => {
    const field = defineField({ type: "enum", values: ["draft", "sent"] });
    expect(validateValue(field, "archived")).toEqual([
      'expected one of [draft, sent], got "archived"',
    ]);
  });

  it("requires a non-empty values array at definition time", () => {
    expect(() => defineField({ type: "enum", values: [] })).toThrow(
      InvalidFieldDefinitionError
    );
    expect(() => defineField({ type: "enum" })).toThrow(InvalidFieldDefinitionError);
  });

  it("rejects non-string values array entries at definition time", () => {
    expect(() => defineField({ type: "enum", values: ["a", 2] })).toThrow(
      InvalidFieldDefinitionError
    );
  });

  it("rejects duplicate values at definition time", () => {
    expect(() =>
      defineField({ type: "enum", values: ["a", "b", "a"] })
    ).toThrow(InvalidFieldDefinitionError);
  });

  it("casts (passes through) a valid value unchanged", () => {
    const field = defineField({ type: "enum", values: ["a", "b"] });
    expect(castValue(field, "a")).toBe("a");
  });

  it("throws CastError for a value outside the allowed set", () => {
    const field = defineField({ type: "enum", values: ["a", "b"] });
    expect(() => castValue(field, "c")).toThrow(CastError);
  });
});
