import { describe, it, expect } from "vitest";
import { defineField } from "../../../../src/fields/define-field.js";
import { validateValue } from "../../../../src/fields/validate-value.js";
import { castValue } from "../../../../src/fields/cast-value.js";
import { CastError } from "../../../../src/fields/errors.js";

// Since 0.1.3 a `date` field's value is a calendar day as "YYYY-MM-DD" text, not a Date.
describe("date field type", () => {
  const field = defineField({ type: "date" });

  it("accepts a real calendar date in the canonical form", () => {
    expect(validateValue(field, "2026-01-15")).toEqual([]);
  });

  it("validate is strict: a Date object or an impossible day is rejected", () => {
    expect(validateValue(field, new Date("2026-01-15"))[0]).toMatch(/expected a real calendar date/);
    expect(validateValue(field, "2026-02-30")[0]).toMatch(/expected a real calendar date/);
  });

  it("casts a date string to the canonical form", () => {
    expect(castValue(field, "2026-1-5")).toBe("2026-01-05");
    expect(castValue(field, "2026-01-15T23:30:00Z")).toBe("2026-01-15"); // time ignored without a timeZone
  });

  it("casts a Date object to its calendar day", () => {
    expect(castValue(field, new Date(2026, 0, 15))).toBe("2026-01-15");
  });

  it("throws CastError for an unparseable string or an Invalid Date", () => {
    expect(() => castValue(field, "not a date at all")).toThrow(CastError);
    expect(() => castValue(field, new Date("nope"))).toThrow(CastError);
  });

  // 0.1.0-0.1.2 stored `date` values on SQLite as epoch milliseconds. 0.1.3-0.1.5 could not read
  // them back ("cannot cast 1706832000000 to date"); 0.1.6 reads them as the day they meant.
  describe("epoch milliseconds (rows written by 0.1.0-0.1.2)", () => {
    it("reads an instant at UTC midnight as that UTC day", () => {
      expect(castValue(field, Date.UTC(2024, 1, 2))).toBe("2024-02-02");
      expect(castValue(field, 0)).toBe("1970-01-01");
      expect(castValue(field, Date.UTC(1969, 6, 20))).toBe("1969-07-20"); // pre-1970 (negative) too
    });

    it("reads an instant at local midnight as that local day", () => {
      const localMidnight = new Date(2024, 1, 2).getTime();
      expect(castValue(field, localMidnight)).toBe("2024-02-02");
    });

    it("rejects a number that is not a valid instant", () => {
      expect(() => castValue(field, Number.NaN)).toThrow(CastError);
      expect(() => castValue(field, 8.64e15 + 1)).toThrow(CastError);
    });
  });
});
