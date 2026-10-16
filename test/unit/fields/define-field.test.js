import { describe, it, expect } from "vitest";
import { defineField } from "../../../src/fields/define-field.js";
import { InvalidFieldDefinitionError } from "../../../src/fields/errors.js";

describe("defineField", () => {
  it("fills in defaults for required/unique/index when omitted", () => {
    const field = defineField({ type: "char" });
    expect(field.required).toBe(false);
    expect(field.unique).toBe(false);
    expect(field.index).toBe(false);
  });

  it("preserves explicitly provided options", () => {
    const field = defineField({ type: "char", required: true, maxLength: 10 });
    expect(field.required).toBe(true);
    expect(field.maxLength).toBe(10);
  });

  it("returns a frozen object", () => {
    const field = defineField({ type: "char" });
    expect(Object.isFrozen(field)).toBe(true);
    expect(() => {
      field.required = true;
    }).toThrow();
  });

  it("throws when type is missing", () => {
    expect(() => defineField({})).toThrow(InvalidFieldDefinitionError);
  });

  it("throws when type is unknown", () => {
    expect(() => defineField({ type: "not-a-real-type" })).toThrow(
      InvalidFieldDefinitionError
    );
  });

  it("throws when options is not an object", () => {
    expect(() => defineField(null)).toThrow(InvalidFieldDefinitionError);
    expect(() => defineField("char")).toThrow(InvalidFieldDefinitionError);
  });

  it("runs type-specific option validation (char maxLength)", () => {
    expect(() => defineField({ type: "char", maxLength: -1 })).toThrow(
      /maxLength/
    );
  });

  it("runs type-specific option validation (enum requires values)", () => {
    expect(() => defineField({ type: "enum" })).toThrow(/values/);
  });

  it("allows a required field with a default (NOT NULL + DB default is a normal pattern)", () => {
    const field = defineField({
      type: "enum",
      values: ["draft", "sent"],
      required: true,
      default: "draft",
    });
    expect(field.required).toBe(true);
    expect(field.default).toBe("draft");
  });
});
