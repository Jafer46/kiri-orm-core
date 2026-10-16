import { describe, it, expect } from "vitest";
import { FieldTypeRegistry } from "../../../src/fields/registry.js";
import { InvalidFieldDefinitionError } from "../../../src/fields/errors.js";

describe("FieldTypeRegistry", () => {
  it("registers and retrieves a type definition", () => {
    const registry = new FieldTypeRegistry();
    const def = {
      name: "custom",
      validate: () => [],
      cast: (field, value) => value,
    };
    registry.register(def);
    expect(registry.get("custom")).toBe(def);
    expect(registry.has("custom")).toBe(true);
  });

  it("lists registered type names", () => {
    const registry = new FieldTypeRegistry();
    registry.register({ name: "a", validate: () => [], cast: (f, v) => v });
    registry.register({ name: "b", validate: () => [], cast: (f, v) => v });
    expect(registry.names().sort()).toEqual(["a", "b"]);
  });

  it("throws on get() for an unknown type, listing known types", () => {
    const registry = new FieldTypeRegistry();
    registry.register({ name: "known", validate: () => [], cast: (f, v) => v });
    expect(() => registry.get("missing")).toThrow(InvalidFieldDefinitionError);
    expect(() => registry.get("missing")).toThrow(/known/);
  });

  it("rejects a definition with no name", () => {
    const registry = new FieldTypeRegistry();
    expect(() =>
      registry.register({ validate: () => [], cast: (f, v) => v })
    ).toThrow(InvalidFieldDefinitionError);
  });

  it("rejects a definition missing validate()", () => {
    const registry = new FieldTypeRegistry();
    expect(() => registry.register({ name: "x", cast: (f, v) => v })).toThrow(
      InvalidFieldDefinitionError
    );
  });

  it("rejects a definition missing cast()", () => {
    const registry = new FieldTypeRegistry();
    expect(() => registry.register({ name: "x", validate: () => [] })).toThrow(
      InvalidFieldDefinitionError
    );
  });

  it("is isolated per instance - registering on one doesn't affect another", () => {
    const a = new FieldTypeRegistry();
    const b = new FieldTypeRegistry();
    a.register({ name: "onlyOnA", validate: () => [], cast: (f, v) => v });
    expect(a.has("onlyOnA")).toBe(true);
    expect(b.has("onlyOnA")).toBe(false);
  });
});
