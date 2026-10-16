import { describe, it, expect } from "vitest";
import { defineModel } from "../../../src/models/define-model.js";
import { InvalidModelDefinitionError } from "../../../src/models/errors.js";
import { identityNamingStrategy } from "../../../src/models/naming.js";

describe("defineModel", () => {
  it("builds a model descriptor with default (snake_case) naming", () => {
    const model = defineModel({
      name: "invoiceLine",
      fields: {
        id: { type: "integer", required: true },
        customerId: { type: "integer", required: true },
        description: { type: "text" },
      },
    });

    expect(model.name).toBe("invoiceLine");
    expect(model.tableName).toBe("invoice_line");
    expect(model.columns).toEqual({
      id: "id",
      customerId: "customer_id",
      description: "description",
    });
    expect(model.fields.customerId.type).toBe("integer");
    expect(model.fields.customerId.required).toBe(true);
  });

  it("honors an explicit table name over the naming strategy", () => {
    const model = defineModel({
      name: "invoice",
      table: "invoices",
      fields: { id: { type: "integer" } },
    });
    expect(model.tableName).toBe("invoices");
  });

  it("honors an explicit column name on a field over the naming strategy", () => {
    const model = defineModel({
      name: "invoice",
      fields: {
        customerId: { type: "integer", column: "cust_id" },
      },
    });
    expect(model.columns.customerId).toBe("cust_id");
  });

  it("supports a different naming strategy (identity)", () => {
    const model = defineModel(
      {
        name: "Invoice",
        fields: { customerId: { type: "integer" } },
      },
      identityNamingStrategy
    );
    expect(model.tableName).toBe("Invoice");
    expect(model.columns.customerId).toBe("customerId");
  });

  it("runs each field through defineField, surfacing its validation errors", () => {
    expect(() =>
      defineModel({
        name: "invoice",
        fields: { amount: { type: "not-a-real-type" } },
      })
    ).toThrow(InvalidModelDefinitionError);
  });

  it("includes the model and field name in a field validation error message", () => {
    expect(() =>
      defineModel({
        name: "invoice",
        fields: { amount: { type: "not-a-real-type" } },
      })
    ).toThrow(/Model "invoice", field "amount"/);
  });

  it("throws on two fields resolving to the same column name", () => {
    expect(() =>
      defineModel({
        name: "invoice",
        fields: {
          customerId: { type: "integer" },
          customer_id: { type: "integer" },
        },
      })
    ).toThrow(/both resolve to column name "customer_id"/);
  });

  it("throws when name is missing or empty", () => {
    expect(() => defineModel({ fields: { id: { type: "integer" } } })).toThrow(
      InvalidModelDefinitionError
    );
    expect(() =>
      defineModel({ name: "  ", fields: { id: { type: "integer" } } })
    ).toThrow(InvalidModelDefinitionError);
  });

  it("throws when fields is missing or empty", () => {
    expect(() => defineModel({ name: "invoice" })).toThrow(
      InvalidModelDefinitionError
    );
    expect(() => defineModel({ name: "invoice", fields: {} })).toThrow(
      InvalidModelDefinitionError
    );
  });

  it("throws when table is provided but not a non-empty string", () => {
    expect(() =>
      defineModel({ name: "invoice", table: "", fields: { id: { type: "integer" } } })
    ).toThrow(InvalidModelDefinitionError);
  });

  it("returns a deeply frozen descriptor", () => {
    const model = defineModel({
      name: "invoice",
      fields: { id: { type: "integer" } },
    });
    expect(Object.isFrozen(model)).toBe(true);
    expect(Object.isFrozen(model.fields)).toBe(true);
    expect(Object.isFrozen(model.columns)).toBe(true);
    expect(Object.isFrozen(model.fields.id)).toBe(true);
  });

  it("defaults relations to an empty object when omitted", () => {
    const model = defineModel({ name: "invoice", fields: { id: { type: "integer" } } });
    expect(model.relations).toEqual({});
  });

  it("defines relations alongside fields", () => {
    const model = defineModel({
      name: "invoice",
      fields: { id: { type: "integer" }, customerId: { type: "integer" } },
      relations: {
        customer: { type: "belongsTo", model: "customer", foreignKey: "customerId" },
      },
    });
    expect(model.relations.customer.type).toBe("belongsTo");
    expect(model.relations.customer.model).toBe("customer");
  });

  it("throws when a relation name collides with a field name", () => {
    expect(() =>
      defineModel({
        name: "invoice",
        fields: { customer: { type: "char" } },
        relations: {
          customer: { type: "belongsTo", model: "customer", foreignKey: "customerId" },
        },
      })
    ).toThrow(InvalidModelDefinitionError);
  });

  it("surfaces a relation definition error with model/relation context", () => {
    expect(() =>
      defineModel({
        name: "invoice",
        fields: { id: { type: "integer" } },
        relations: { customer: { type: "notARealType", model: "customer" } },
      })
    ).toThrow(/Model "invoice", relation "customer"/);
  });

  it("returns frozen relations too", () => {
    const model = defineModel({
      name: "invoice",
      fields: { id: { type: "integer" } },
      relations: { lines: { type: "hasMany", model: "invoiceLine", foreignKey: "invoiceId" } },
    });
    expect(Object.isFrozen(model.relations)).toBe(true);
    expect(Object.isFrozen(model.relations.lines)).toBe(true);
  });
});
