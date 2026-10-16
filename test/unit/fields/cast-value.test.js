import { describe, it, expect } from "vitest";
import { defineField } from "../../../src/fields/define-field.js";
import { castValue } from "../../../src/fields/cast-value.js";
import { CastError } from "../../../src/fields/errors.js";

describe("castValue - null/undefined passthrough", () => {
  it("passes undefined through unchanged", () => {
    const field = defineField({ type: "integer" });
    expect(castValue(field, undefined)).toBeUndefined();
  });

  it("passes null through unchanged", () => {
    const field = defineField({ type: "integer" });
    expect(castValue(field, null)).toBeNull();
  });

  it("delegates to the type's cast() for present values", () => {
    const field = defineField({ type: "integer" });
    expect(castValue(field, "42")).toBe(42);
  });

  it("throws CastError (not a generic Error) on failure", () => {
    const field = defineField({ type: "integer" });
    expect(() => castValue(field, "not a number")).toThrow(CastError);
  });
});
