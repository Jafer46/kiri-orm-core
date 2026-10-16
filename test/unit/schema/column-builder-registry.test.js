import { describe, it, expect } from "vitest";
import { ColumnBuilderRegistry } from "../../../src/schema/column-builder-registry.js";
import { defaultColumnBuilderRegistry } from "../../../src/schema/default-column-builders.js";
import { SchemaSyncError } from "../../../src/schema/errors.js";

describe("ColumnBuilderRegistry", () => {
  it("registers and retrieves a builder function", () => {
    const registry = new ColumnBuilderRegistry();
    const fn = (table, columnName) => table.string(columnName);
    registry.register("custom", fn);
    expect(registry.get("custom")).toBe(fn);
    expect(registry.has("custom")).toBe(true);
  });

  it("throws with a helpful message for an unregistered type", () => {
    const registry = new ColumnBuilderRegistry();
    registry.register("known", () => {});
    expect(() => registry.get("missing")).toThrow(SchemaSyncError);
    expect(() => registry.get("missing")).toThrow(/known/);
  });

  it("rejects registration without a type name or function", () => {
    const registry = new ColumnBuilderRegistry();
    expect(() => registry.register("", () => {})).toThrow(SchemaSyncError);
    expect(() => registry.register("x", "not a function")).toThrow(SchemaSyncError);
  });

  it("is isolated per instance", () => {
    const a = new ColumnBuilderRegistry();
    const b = new ColumnBuilderRegistry();
    a.register("onlyOnA", () => {});
    expect(a.has("onlyOnA")).toBe(true);
    expect(b.has("onlyOnA")).toBe(false);
  });
});

describe("defaultColumnBuilderRegistry", () => {
  it("has a builder registered for every built-in field type", () => {
    for (const type of ["char", "text", "integer", "float", "boolean", "date", "datetime", "json", "enum"]) {
      expect(defaultColumnBuilderRegistry.has(type)).toBe(true);
    }
  });
});
