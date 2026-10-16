import { describe, it, expect } from "vitest";
import { defineModel } from "../../../src/models/define-model.js";
import {
  generateCreateSchema,
  generateUpdateSchema,
  generateReadSchema,
  generateDTOSchemas,
} from "../../../src/dto/schema-generator.js";

const invoiceModel = defineModel({
  name: "invoice",
  fields: {
    id: { type: "integer", required: true },
    customerId: { type: "integer", required: true },
    title: { type: "char", maxLength: 100 },
    total: { type: "float", min: 0 },
    status: { type: "enum", values: ["draft", "sent", "paid"], default: "draft" },
    notes: { type: "text" },
    isPaid: { type: "boolean" },
    dueDate: { type: "date" },
    createdAt: { type: "datetime", required: true, default: () => new Date() },
    metadata: { type: "json" },
  },
});

describe("generateCreateSchema - golden file", () => {
  it("matches the exact expected JSON Schema", () => {
    expect(generateCreateSchema(invoiceModel)).toEqual({
      type: "object",
      title: "CreateInvoice",
      properties: {
        customerId: { type: "integer" },
        title: { type: "string", maxLength: 100 },
        total: { type: "number", minimum: 0 },
        status: { type: "string", enum: ["draft", "sent", "paid"] },
        notes: { type: "string" },
        isPaid: { type: "boolean" },
        dueDate: { type: "string", format: "date" },
        createdAt: { type: "string", format: "date-time" },
        metadata: {},
      },
      required: ["customerId"],
    });
  });

  it("excludes `id` entirely", () => {
    const schema = generateCreateSchema(invoiceModel);
    expect(schema.properties).not.toHaveProperty("id");
  });

  it("does not require a field that's required but has a default (createdAt)", () => {
    const schema = generateCreateSchema(invoiceModel);
    expect(schema.required).not.toContain("createdAt");
  });
});

describe("generateUpdateSchema - golden file", () => {
  it("matches the exact expected JSON Schema - same properties as create, nothing required", () => {
    const schema = generateUpdateSchema(invoiceModel);
    expect(schema).toEqual({
      type: "object",
      title: "UpdateInvoice",
      properties: {
        customerId: { type: "integer" },
        title: { type: "string", maxLength: 100 },
        total: { type: "number", minimum: 0 },
        status: { type: "string", enum: ["draft", "sent", "paid"] },
        notes: { type: "string" },
        isPaid: { type: "boolean" },
        dueDate: { type: "string", format: "date" },
        createdAt: { type: "string", format: "date-time" },
        metadata: {},
      },
    });
  });

  it("has no `required` key at all", () => {
    expect(generateUpdateSchema(invoiceModel).required).toBeUndefined();
  });
});

describe("generateReadSchema - golden file", () => {
  it("matches the exact expected JSON Schema - includes id, required fields listed", () => {
    expect(generateReadSchema(invoiceModel)).toEqual({
      type: "object",
      title: "ReadInvoice",
      properties: {
        id: { type: "integer" },
        customerId: { type: "integer" },
        title: { type: "string", maxLength: 100 },
        total: { type: "number", minimum: 0 },
        status: { type: "string", enum: ["draft", "sent", "paid"] },
        notes: { type: "string" },
        isPaid: { type: "boolean" },
        dueDate: { type: "string", format: "date" },
        createdAt: { type: "string", format: "date-time" },
        metadata: {},
      },
      required: ["id", "customerId", "createdAt"],
    });
  });
});

describe("generateDTOSchemas", () => {
  it("returns all three shapes at once, matching the individual generator outputs", () => {
    const all = generateDTOSchemas(invoiceModel);
    expect(all.create).toEqual(generateCreateSchema(invoiceModel));
    expect(all.update).toEqual(generateUpdateSchema(invoiceModel));
    expect(all.read).toEqual(generateReadSchema(invoiceModel));
  });
});

describe("exit criteria: DTOs regenerate correctly when a model changes, no manual sync step", () => {
  it("a field added to a model's definition appears in freshly-generated DTOs with no extra step", () => {
    const modelV1 = defineModel({
      name: "widget",
      fields: { id: { type: "integer", required: true }, name: { type: "char", required: true } },
    });
    const schemaV1 = generateCreateSchema(modelV1);
    expect(schemaV1.properties).not.toHaveProperty("weightGrams");

    // "Changing the model" - since descriptors are immutable
    // (Phase 2), this means defining a new version, exactly what
    // happens in a real app when a model's field list is edited and
    // the process restarts. Nothing about the generator itself is
    // called differently here - same function, same call.
    const modelV2 = defineModel({
      name: "widget",
      fields: {
        id: { type: "integer", required: true },
        name: { type: "char", required: true },
        weightGrams: { type: "integer", min: 0 },
      },
    });
    const schemaV2 = generateCreateSchema(modelV2);

    expect(schemaV2.properties).toHaveProperty("weightGrams");
    expect(schemaV2.properties.weightGrams).toEqual({ type: "integer", minimum: 0 });
    // The original schema object, generated before the change, is
    // untouched - there's no shared mutable cache anywhere in this
    // module that a stale reference could be reading from.
    expect(schemaV1.properties).not.toHaveProperty("weightGrams");
  });

  it("a field removed from a model's definition disappears from freshly-generated DTOs with no extra step", () => {
    const modelV1 = defineModel({
      name: "widget",
      fields: {
        id: { type: "integer", required: true },
        name: { type: "char", required: true },
        legacyCode: { type: "char" },
      },
    });
    expect(generateReadSchema(modelV1).properties).toHaveProperty("legacyCode");

    const modelV2 = defineModel({
      name: "widget",
      fields: { id: { type: "integer", required: true }, name: { type: "char", required: true } },
    });
    expect(generateReadSchema(modelV2).properties).not.toHaveProperty("legacyCode");
  });

  it("calling the same generator function twice on the SAME model definition is deterministic (no hidden state)", () => {
    const model = defineModel({
      name: "widget",
      fields: { id: { type: "integer", required: true }, name: { type: "char", required: true } },
    });
    expect(generateCreateSchema(model)).toEqual(generateCreateSchema(model));
  });
});
