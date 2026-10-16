import { describe, it, expect } from "vitest";
import { HookRegistry, HOOK_NAMES } from "../../../src/uow/hooks.js";
import { InvalidHookNameError } from "../../../src/uow/errors.js";

describe("HookRegistry", () => {
  it("runs registered hooks in registration order", async () => {
    const registry = new HookRegistry();
    const calls = [];
    registry.on("invoice", "beforeSave", () => calls.push("first"));
    registry.on("invoice", "beforeSave", () => calls.push("second"));
    registry.on("invoice", "beforeSave", () => calls.push("third"));

    await registry.run("invoice", "beforeSave");
    expect(calls).toEqual(["first", "second", "third"]);
  });

  it("awaits each hook before starting the next", async () => {
    const registry = new HookRegistry();
    const calls = [];
    registry.on("invoice", "beforeSave", async () => {
      await new Promise((r) => setTimeout(r, 10));
      calls.push("slow-first");
    });
    registry.on("invoice", "beforeSave", () => calls.push("fast-second"));

    await registry.run("invoice", "beforeSave");
    expect(calls).toEqual(["slow-first", "fast-second"]);
  });

  it("passes arguments through to each hook", async () => {
    const registry = new HookRegistry();
    let received;
    registry.on("invoice", "afterCreate", (entity) => {
      received = entity;
    });
    const fakeEntity = { id: 1 };
    await registry.run("invoice", "afterCreate", fakeEntity);
    expect(received).toBe(fakeEntity);
  });

  it("propagates an error from a hook and stops running subsequent hooks", async () => {
    const registry = new HookRegistry();
    const calls = [];
    registry.on("invoice", "beforeSave", () => calls.push("first"));
    registry.on("invoice", "beforeSave", () => {
      throw new Error("hook failed");
    });
    registry.on("invoice", "beforeSave", () => calls.push("never runs"));

    await expect(registry.run("invoice", "beforeSave")).rejects.toThrow("hook failed");
    expect(calls).toEqual(["first"]);
  });

  it("propagates a rejected promise from an async hook", async () => {
    const registry = new HookRegistry();
    registry.on("invoice", "beforeSave", async () => {
      throw new Error("async hook failed");
    });
    await expect(registry.run("invoice", "beforeSave")).rejects.toThrow("async hook failed");
  });

  it("is a no-op when no hooks are registered for that model/name", async () => {
    const registry = new HookRegistry();
    await expect(registry.run("invoice", "beforeSave")).resolves.toBeUndefined();
  });

  it("scopes hooks per model - hooks on one model don't fire for another", async () => {
    const registry = new HookRegistry();
    const calls = [];
    registry.on("invoice", "beforeSave", () => calls.push("invoice"));
    registry.on("customer", "beforeSave", () => calls.push("customer"));

    await registry.run("invoice", "beforeSave");
    expect(calls).toEqual(["invoice"]);
  });

  it("rejects registering an unknown hook name", () => {
    const registry = new HookRegistry();
    expect(() => registry.on("invoice", "beforeFrobnicate", () => {})).toThrow(
      InvalidHookNameError
    );
  });

  it("rejects a non-function handler", () => {
    const registry = new HookRegistry();
    expect(() => registry.on("invoice", "beforeSave", "not-a-function")).toThrow(
      InvalidHookNameError
    );
  });

  it("exposes the full set of valid hook names", () => {
    expect(HOOK_NAMES).toEqual([
      "beforeCreate",
      "afterCreate",
      "beforeUpdate",
      "afterUpdate",
      "beforeSave",
      "afterSave",
      "beforeDelete",
      "afterDelete",
    ]);
  });
});
