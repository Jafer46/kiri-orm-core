import { describe, it, expect } from "vitest";
import { defineField } from "../../../../src/fields/define-field.js";
import { validateValue } from "../../../../src/fields/validate-value.js";
import { castValue } from "../../../../src/fields/cast-value.js";
import { CastError } from "../../../../src/fields/errors.js";

describe("date field type", () => {
  it("accepts a valid Date object", () => {
    const field = defineField({ type: "date" });
    expect(validateValue(field, new Date("2026-01-15"))).toEqual([]);
  });

  it("rejects an Invalid Date object", () => {
    const field = defineField({ type: "date" });
    const invalid = new Date("not a date");
    expect(validateValue(field, invalid)[0]).toMatch(/expected a valid Date/);
  });

  it("rejects a plain string (validate, not cast)", () => {
    const field = defineField({ type: "date" });
    expect(validateValue(field, "2026-01-15")[0]).toMatch(/expected a valid Date/);
  });

  it("casts an ISO string to a Date", () => {
    const field = defineField({ type: "date" });
    const cast = castValue(field, "2026-01-15");
    expect(cast).toBeInstanceOf(Date);
    expect(cast.getUTCFullYear()).toBe(2026);
  });

  it("casts a unix timestamp number to a Date", () => {
    const field = defineField({ type: "date" });
    const cast = castValue(field, 0);
    expect(cast).toBeInstanceOf(Date);
    expect(cast.getTime()).toBe(0);
  });

  it("throws CastError for an unparseable string", () => {
    const field = defineField({ type: "date" });
    expect(() => castValue(field, "not a date at all")).toThrow(CastError);
  });
});
