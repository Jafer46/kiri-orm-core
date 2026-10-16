import { describe, it, expect } from "vitest";
import { ModelRegistry } from "../../../src/models/registry.js";
import {
  ModelConflictError,
  UnknownModelError,
} from "../../../src/models/errors.js";
import { defineModel } from "../../../src/models/define-model.js";

describe("ModelRegistry", () => {
  it("defines and retrieves a model", () => {
    const registry = new ModelRegistry();
    registry.define({
      name: "invoice",
      fields: { id: { type: "integer", required: true } },
    });

    const model = registry.getModel("invoice");
    expect(model.name).toBe("invoice");
    expect(model.tableName).toBe("invoice");
  });

  it("getFields() returns just the fields map", () => {
    const registry = new ModelRegistry();
    registry.define({
      name: "invoice",
      fields: { id: { type: "integer" } },
    });
    expect(registry.getFields("invoice")).toEqual(
      registry.getModel("invoice").fields
    );
  });

  it("hasModel() reflects registration state", () => {
    const registry = new ModelRegistry();
    expect(registry.hasModel("invoice")).toBe(false);
    registry.define({ name: "invoice", fields: { id: { type: "integer" } } });
    expect(registry.hasModel("invoice")).toBe(true);
  });

  it("listModels() returns registered model names", () => {
    const registry = new ModelRegistry();
    registry.define({ name: "invoice", fields: { id: { type: "integer" } } });
    registry.define({ name: "customer", fields: { id: { type: "integer" } } });
    expect(registry.listModels().sort()).toEqual(["customer", "invoice"]);
  });

  it("throws UnknownModelError with a helpful message for a missing model", () => {
    const registry = new ModelRegistry();
    registry.define({ name: "invoice", fields: { id: { type: "integer" } } });
    expect(() => registry.getModel("missing")).toThrow(UnknownModelError);
    expect(() => registry.getModel("missing")).toThrow(/invoice/);
  });

  it("throws ModelConflictError on duplicate model name registration", () => {
    const registry = new ModelRegistry();
    registry.define({ name: "invoice", fields: { id: { type: "integer" } } });
    expect(() =>
      registry.define({ name: "invoice", fields: { id: { type: "integer" } } })
    ).toThrow(ModelConflictError);
  });

  it("throws ModelConflictError when two models resolve to the same table name", () => {
    const registry = new ModelRegistry();
    registry.define({
      name: "invoice",
      table: "docs",
      fields: { id: { type: "integer" } },
    });
    expect(() =>
      registry.define({
        name: "creditNote",
        table: "docs",
        fields: { id: { type: "integer" } },
      })
    ).toThrow(/table "docs"/);
  });

  it("throws ModelConflictError when a model's table name uses the reserved meta-table prefix", () => {
    const registry = new ModelRegistry();
    expect(() =>
      registry.define({
        name: "invoice",
        table: "_meta_models",
        fields: { id: { type: "integer" } },
      })
    ).toThrow(ModelConflictError);
  });

  it("register() accepts a model built externally via defineModel()", () => {
    const registry = new ModelRegistry();
    const model = defineModel({
      name: "invoice",
      fields: { id: { type: "integer" } },
    });
    registry.register(model);
    expect(registry.getModel("invoice")).toBe(model);
  });

  it("is isolated per instance", () => {
    const a = new ModelRegistry();
    const b = new ModelRegistry();
    a.define({ name: "onlyOnA", fields: { id: { type: "integer" } } });
    expect(a.hasModel("onlyOnA")).toBe(true);
    expect(b.hasModel("onlyOnA")).toBe(false);
  });

  it("uses a custom naming strategy passed at construction for define()", () => {
    const registry = new ModelRegistry({
      namingStrategy: {
        modelToTable: (name) => `tbl_${name}`,
        fieldToColumn: (name) => name,
      },
    });
    const model = registry.define({
      name: "invoice",
      fields: { id: { type: "integer" } },
    });
    expect(model.tableName).toBe("tbl_invoice");
  });
});
