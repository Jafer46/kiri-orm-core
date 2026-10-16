import { describe, it, expect } from "vitest";
import { defineModel } from "../../../src/models/define-model.js";
import { prepareWrite } from "../../../src/crud/prepare-write.js";

const invoiceModel = defineModel({
  name: "invoice",
  fields: {
    id: { type: "integer", required: true },
    customerId: { type: "integer", required: true },
    status: { type: "enum", values: ["draft", "sent"], default: "draft" },
    total: { type: "float" },
  },
});

describe("prepareWrite - create semantics (partial: false)", () => {
  it("applies a static default for an omitted field", () => {
    const { errors, values } = prepareWrite(invoiceModel, { id: 1, customerId: 2 });
    expect(errors).toEqual({});
    expect(values.status).toBe("draft");
  });

  it("casts provided values", () => {
    const { values } = prepareWrite(invoiceModel, { id: "1", customerId: "2" });
    expect(values.id).toBe(1);
    expect(values.customerId).toBe(2);
  });

  it("reports a validation error for a missing required field", () => {
    const { errors } = prepareWrite(invoiceModel, { id: 1 });
    expect(errors.customerId).toEqual(["value is required"]);
  });

  it("does not require an auto-increment id, and leaves it out of the values entirely", () => {
    const { errors, values } = prepareWrite(invoiceModel, { customerId: 2 });
    expect(errors).toEqual({});
    expect("id" in values).toBe(false); // absent, so the INSERT omits the column
  });

  it("still requires an id that opted out with `auto: false`", () => {
    const manual = defineModel({ name: "manual", fields: { id: { type: "integer", required: true, auto: false } } });
    expect(prepareWrite(manual, {}).errors.id).toEqual(["value is required"]);
  });

  it("reports validation errors for multiple bad fields at once", () => {
    const { errors } = prepareWrite(invoiceModel, {
      id: "not-a-number",
      customerId: 2,
      total: "also-not-a-number",
    });
    expect(Object.keys(errors).sort()).toEqual(["id", "total"]);
  });

  it("reports an error for an unknown field", () => {
    const { errors } = prepareWrite(invoiceModel, {
      id: 1,
      customerId: 2,
      typo: "oops",
    });
    expect(errors.typo).toEqual(['unknown field "typo" on model "invoice"']);
  });

  it("resolves a factory-function default at write time", () => {
    const modelWithFactory = defineModel({
      name: "widget",
      fields: {
        id: { type: "integer", required: true },
        createdAt: { type: "datetime", default: () => new Date("2026-01-01T00:00:00.000Z") },
      },
    });
    const { values } = prepareWrite(modelWithFactory, { id: 1 });
    expect(values.createdAt).toEqual(new Date("2026-01-01T00:00:00.000Z"));
  });
});

describe("prepareWrite - update semantics (partial: true)", () => {
  it("only includes fields explicitly provided", () => {
    const { values } = prepareWrite(invoiceModel, { total: 42 }, { partial: true });
    expect(values).toEqual({ total: 42 });
  });

  it("does not apply defaults for omitted fields", () => {
    const { values } = prepareWrite(invoiceModel, { total: 42 }, { partial: true });
    expect(values.status).toBeUndefined();
  });

  it("does not error on a missing required field when partial", () => {
    const { errors } = prepareWrite(invoiceModel, { total: 42 }, { partial: true });
    expect(errors).toEqual({});
  });

  it("still validates fields that are provided", () => {
    const { errors } = prepareWrite(invoiceModel, { total: "not-a-number" }, { partial: true });
    expect(errors.total).toBeTruthy();
  });
});
