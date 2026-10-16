import { describe, it, expect } from "vitest";
import { defineModel } from "../../../src/models/define-model.js";
import {
  generateCreateSchema,
  generateUpdateSchema,
  generateReadSchema,
} from "../../../src/dto/schema-generator.js";

const userModel = defineModel({
  name: "user",
  fields: {
    id: { type: "integer", required: true },
    email: { type: "char", required: true },
    passwordHash: { type: "char", required: true, expose: false },
    internalNotes: { type: "text", expose: false, writable: false },
    createdAt: { type: "datetime", required: true, default: () => new Date(), writable: false },
  },
});

describe("expose: false - excluded from read only", () => {
  it("is excluded from the read schema", () => {
    const schema = generateReadSchema(userModel);
    expect(schema.properties).not.toHaveProperty("passwordHash");
  });

  it("is still INCLUDED in the create schema (writable unless writable:false too)", () => {
    const schema = generateCreateSchema(userModel);
    expect(schema.properties).toHaveProperty("passwordHash");
    expect(schema.required).toContain("passwordHash");
  });

  it("is still included in the update schema", () => {
    const schema = generateUpdateSchema(userModel);
    expect(schema.properties).toHaveProperty("passwordHash");
  });
});

describe("writable: false - excluded from create and update only", () => {
  it("is excluded from the create schema", () => {
    const schema = generateCreateSchema(userModel);
    expect(schema.properties).not.toHaveProperty("createdAt");
  });

  it("is excluded from the update schema", () => {
    const schema = generateUpdateSchema(userModel);
    expect(schema.properties).not.toHaveProperty("createdAt");
  });

  it("is still included in the read schema (visible, just not settable)", () => {
    const schema = generateReadSchema(userModel);
    expect(schema.properties).toHaveProperty("createdAt");
  });
});

describe("expose: false AND writable: false together - excluded everywhere", () => {
  it("is excluded from all three schemas", () => {
    expect(generateCreateSchema(userModel).properties).not.toHaveProperty("internalNotes");
    expect(generateUpdateSchema(userModel).properties).not.toHaveProperty("internalNotes");
    expect(generateReadSchema(userModel).properties).not.toHaveProperty("internalNotes");
  });
});

describe("fields with neither flag set - included everywhere by default", () => {
  it("email (no expose/writable flags) appears in all three schemas", () => {
    expect(generateCreateSchema(userModel).properties).toHaveProperty("email");
    expect(generateUpdateSchema(userModel).properties).toHaveProperty("email");
    expect(generateReadSchema(userModel).properties).toHaveProperty("email");
  });
});
