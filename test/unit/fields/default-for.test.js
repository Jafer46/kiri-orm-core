import { describe, it, expect } from "vitest";
import { defineField } from "../../../src/fields/define-field.js";
import { defaultFor } from "../../../src/fields/default-for.js";

describe("defaultFor", () => {
  it("returns undefined when no default is configured", () => {
    const field = defineField({ type: "char" });
    expect(defaultFor(field)).toBeUndefined();
  });

  it("returns a static default value", () => {
    const field = defineField({
      type: "enum",
      values: ["draft", "sent"],
      default: "draft",
    });
    expect(defaultFor(field)).toBe("draft");
  });

  it("resolves a factory function default", () => {
    const field = defineField({ type: "integer", default: () => 42 });
    expect(defaultFor(field)).toBe(42);
  });

  it("calls the factory function fresh each time (per-record defaults)", () => {
    let counter = 0;
    const field = defineField({ type: "integer", default: () => ++counter });
    expect(defaultFor(field)).toBe(1);
    expect(defaultFor(field)).toBe(2);
  });
});
