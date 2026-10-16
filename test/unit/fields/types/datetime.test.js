import { describe, it, expect } from "vitest";
import { defineField } from "../../../../src/fields/define-field.js";
import { validateValue } from "../../../../src/fields/validate-value.js";
import { castValue } from "../../../../src/fields/cast-value.js";
import { CastError } from "../../../../src/fields/errors.js";

describe("datetime field type", () => {
  it("accepts a valid Date object", () => {
    const field = defineField({ type: "datetime" });
    expect(validateValue(field, new Date())).toEqual([]);
  });

  it("rejects an Invalid Date object", () => {
    const field = defineField({ type: "datetime" });
    expect(validateValue(field, new Date("bad"))[0]).toMatch(/expected a valid Date/);
  });

  it("casts an ISO datetime string to a Date, preserving time", () => {
    const field = defineField({ type: "datetime" });
    const cast = castValue(field, "2026-01-15T10:30:00.000Z");
    expect(cast).toBeInstanceOf(Date);
    expect(cast.getUTCHours()).toBe(10);
    expect(cast.getUTCMinutes()).toBe(30);
  });

  it("throws CastError for an unparseable string", () => {
    const field = defineField({ type: "datetime" });
    expect(() => castValue(field, "nonsense")).toThrow(CastError);
  });

  it("is a distinct registered type from date (for future column-mapping)", () => {
    const dateField = defineField({ type: "date" });
    const datetimeField = defineField({ type: "datetime" });
    expect(dateField.type).toBe("date");
    expect(datetimeField.type).toBe("datetime");
  });
});
