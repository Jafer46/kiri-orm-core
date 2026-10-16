import { describe, it, expect } from "vitest";
import { defineField } from "../../../src/fields/define-field.js";
import { fieldToJsonSchema } from "../../../src/dto/field-schema.js";

describe("fieldToJsonSchema", () => {
  it("char -> string, with maxLength/minLength when set", () => {
    expect(fieldToJsonSchema(defineField({ type: "char" }))).toEqual({ type: "string" });
    expect(fieldToJsonSchema(defineField({ type: "char", maxLength: 50, minLength: 2 }))).toEqual({
      type: "string",
      maxLength: 50,
      minLength: 2,
    });
  });

  it("text -> string", () => {
    expect(fieldToJsonSchema(defineField({ type: "text" }))).toEqual({ type: "string" });
  });

  it("integer -> integer, with minimum/maximum when set", () => {
    expect(fieldToJsonSchema(defineField({ type: "integer" }))).toEqual({ type: "integer" });
    expect(fieldToJsonSchema(defineField({ type: "integer", min: 0, max: 100 }))).toEqual({
      type: "integer",
      minimum: 0,
      maximum: 100,
    });
  });

  it("float -> number, with minimum/maximum when set", () => {
    expect(fieldToJsonSchema(defineField({ type: "float", min: 0 }))).toEqual({
      type: "number",
      minimum: 0,
    });
  });

  it("boolean -> boolean", () => {
    expect(fieldToJsonSchema(defineField({ type: "boolean" }))).toEqual({ type: "boolean" });
  });

  it("date -> string with date format", () => {
    expect(fieldToJsonSchema(defineField({ type: "date" }))).toEqual({ type: "string", format: "date" });
  });

  it("datetime -> string with date-time format", () => {
    expect(fieldToJsonSchema(defineField({ type: "datetime" }))).toEqual({
      type: "string",
      format: "date-time",
    });
  });

  it("json -> unconstrained (empty schema)", () => {
    expect(fieldToJsonSchema(defineField({ type: "json" }))).toEqual({});
  });

  it("enum -> string with the enum values", () => {
    expect(fieldToJsonSchema(defineField({ type: "enum", values: ["a", "b"] }))).toEqual({
      type: "string",
      enum: ["a", "b"],
    });
  });
});
