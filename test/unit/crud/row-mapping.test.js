import { describe, it, expect } from "vitest";
import { defineModel } from "../../../src/models/define-model.js";
import { fromRow, toRow } from "../../../src/crud/row-mapping.js";

const model = defineModel({
  name: "invoice",
  fields: {
    id: { type: "integer", required: true },
    customerId: { type: "integer", required: true },
    createdAt: { type: "datetime" },
    metadata: { type: "json" },
    isPaid: { type: "boolean" },
  },
});

describe("toRow", () => {
  it("renames field-name keys to column-name keys", () => {
    const row = toRow(model, { id: 1, customerId: 2 });
    expect(row).toEqual({ id: 1, customer_id: 2 });
  });
});

describe("fromRow", () => {
  it("renames column-name keys back to field-name keys", () => {
    const record = fromRow(model, { id: 1, customer_id: 2 });
    expect(record).toEqual({ id: 1, customerId: 2 });
  });

  it("casts a raw ISO string back into a Date for datetime fields", () => {
    const record = fromRow(model, { id: 1, customer_id: 2, created_at: "2026-01-15T10:00:00.000Z" });
    expect(record.createdAt).toBeInstanceOf(Date);
  });

  it("parses a JSON-string column (sqlite's text-based json storage) into an object", () => {
    const record = fromRow(model, { id: 1, customer_id: 2, metadata: '{"tag":"vip"}' });
    expect(record.metadata).toEqual({ tag: "vip" });
  });

  it("passes through an already-parsed json value (postgres jsonb) unchanged", () => {
    const record = fromRow(model, { id: 1, customer_id: 2, metadata: { tag: "vip" } });
    expect(record.metadata).toEqual({ tag: "vip" });
  });

  it("normalizes 0/1 integers into booleans for boolean fields", () => {
    const record = fromRow(model, { id: 1, customer_id: 2, is_paid: 1 });
    expect(record.isPaid).toBe(true);
  });

  it("leaves null values as null rather than attempting to cast them", () => {
    const record = fromRow(model, { id: 1, customer_id: 2, created_at: null });
    expect(record.createdAt).toBeNull();
  });

  it("skips columns not present in the row (partial selects)", () => {
    const record = fromRow(model, { id: 1 });
    expect(record).toEqual({ id: 1 });
  });
});
