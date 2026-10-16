import { describe, it, expect } from "vitest";
import { describePlan } from "../../../src/migrations/describe.js";

function emptyPlan() {
  return { createModels: [], dropModels: [], renameModels: [], possibleModelRenames: null, fieldChanges: {} };
}

describe("describePlan", () => {
  it("reports no changes for an empty plan", () => {
    expect(describePlan(emptyPlan())).toEqual([
      "(no changes - registry matches the last synced state)",
    ]);
  });

  it("marks a create as [safe]", () => {
    const plan = { ...emptyPlan(), createModels: ["invoice"] };
    expect(describePlan(plan)[0]).toMatch(/^\[safe\]/);
    expect(describePlan(plan)[0]).toContain('create model "invoice"');
  });

  it("marks a drop model as [DESTRUCTIVE]", () => {
    const plan = {
      ...emptyPlan(),
      dropModels: [{ modelName: "customer", tableName: "customer", fields: {}, columns: {} }],
    };
    expect(describePlan(plan)[0]).toMatch(/^\[DESTRUCTIVE\]/);
  });

  it("marks a table rename as [safe]", () => {
    const plan = {
      ...emptyPlan(),
      renameModels: [{ modelName: "invoice", fromTable: "invoices_v1", toTable: "invoices_v2" }],
    };
    const line = describePlan(plan)[0];
    expect(line).toMatch(/^\[safe\]/);
    expect(line).toContain("invoices_v1");
    expect(line).toContain("invoices_v2");
  });

  it("marks a type change as [MANUAL]", () => {
    const plan = {
      ...emptyPlan(),
      fieldChanges: {
        invoice: {
          addFields: [],
          dropFields: [],
          renameFields: [],
          columnRenames: [],
          typeChanges: [{ fieldName: "amount", from: "integer", to: "float" }],
          possibleFieldRenames: null,
        },
      },
    };
    expect(describePlan(plan)[0]).toMatch(/^\[MANUAL\]/);
  });

  it("surfaces possibleModelRenames as [ambiguous]", () => {
    const plan = {
      ...emptyPlan(),
      possibleModelRenames: { removed: ["oldName"], added: ["newName"] },
    };
    expect(describePlan(plan).some((l) => l.startsWith("[ambiguous]"))).toBe(true);
  });

  it("surfaces possibleFieldRenames as [ambiguous]", () => {
    const plan = {
      ...emptyPlan(),
      fieldChanges: {
        invoice: {
          addFields: [],
          dropFields: [],
          renameFields: [],
          columnRenames: [],
          typeChanges: [],
          possibleFieldRenames: { removed: ["customerId"], added: ["clientId"] },
        },
      },
    };
    expect(describePlan(plan).some((l) => l.startsWith("[ambiguous]"))).toBe(true);
  });
});
