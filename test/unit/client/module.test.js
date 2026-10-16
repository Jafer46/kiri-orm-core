import { describe, it, expect } from "vitest";
import { defineModule } from "../../../src/client/module.js";

describe("defineModule", () => {
  it("builds a module with defaults", () => {
    const mod = defineModule({ name: "identity", models: [{ name: "user", fields: {} }] });
    expect(mod.name).toBe("identity");
    expect(mod.models).toHaveLength(1);
    expect(typeof mod.registerHooks).toBe("function");
  });

  it("returns a frozen object", () => {
    const mod = defineModule({ name: "identity", models: [{ name: "user", fields: {} }] });
    expect(Object.isFrozen(mod)).toBe(true);
  });

  it("preserves an explicit registerHooks function", () => {
    let called = false;
    const mod = defineModule({
      name: "identity",
      models: [{ name: "user", fields: {} }],
      registerHooks: () => {
        called = true;
      },
    });
    mod.registerHooks();
    expect(called).toBe(true);
  });

  it("throws when name is missing", () => {
    expect(() => defineModule({ models: [{ name: "user", fields: {} }] })).toThrow(TypeError);
  });

  it("throws when models is missing or empty", () => {
    expect(() => defineModule({ name: "identity" })).toThrow(TypeError);
    expect(() => defineModule({ name: "identity", models: [] })).toThrow(TypeError);
  });

  it("accepts a createService factory", () => {
    const mod = defineModule({
      name: "identity",
      models: [{ name: "user", fields: {} }],
      createService: (client) => ({ createUser: () => client }),
    });
    expect(typeof mod.createService).toBe("function");
  });

  it("defaults createService to null when omitted", () => {
    const mod = defineModule({ name: "identity", models: [{ name: "user", fields: {} }] });
    expect(mod.createService).toBeNull();
  });

  it("throws when createService is provided but not a function", () => {
    expect(() =>
      defineModule({ name: "identity", models: [{ name: "user", fields: {} }], createService: "not-a-function" })
    ).toThrow(TypeError);
  });
});
