import { describe, it, expect } from "vitest";
import { ModelRegistry } from "../../../src/models/registry.js";
import { generateDTOSchemasForRegistry } from "../../../src/dto/schema-generator.js";
import { generateJSDocForRegistry } from "../../../src/dto/jsdoc-generator.js";

function buildRegistry() {
  const registry = new ModelRegistry();
  registry.define({
    name: "customer",
    fields: { id: { type: "integer", required: true }, name: { type: "char", required: true } },
  });
  registry.define({
    name: "invoice",
    fields: { id: { type: "integer", required: true }, customerId: { type: "integer", required: true } },
  });
  return registry;
}

describe("generateDTOSchemasForRegistry", () => {
  it("returns DTO schemas for every registered model, keyed by model name", () => {
    const registry = buildRegistry();
    const all = generateDTOSchemasForRegistry(registry);
    expect(Object.keys(all).sort()).toEqual(["customer", "invoice"]);
    expect(all.customer.create.title).toBe("CreateCustomer");
    expect(all.invoice.read.title).toBe("ReadInvoice");
  });
});

describe("generateJSDocForRegistry", () => {
  it("concatenates typedefs for every model", () => {
    const registry = buildRegistry();
    const output = generateJSDocForRegistry(registry);
    expect(output).toContain("@typedef {Object} CreateCustomer");
    expect(output).toContain("@typedef {Object} CreateInvoice");
    expect(output).toContain("@typedef {Object} ReadInvoice");
  });
});
