import { CastError } from "../errors.js";

function isValidDate(d) {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

/**
 * A calendar date (no time component, though the canonical runtime
 * representation is still a JS Date - the schema-sync layer in a later
 * phase is what maps this to a DATE vs DATETIME column per dialect).
 */
export const dateType = {
  name: "date",

  validate(field, value) {
    if (!isValidDate(value)) {
      return [`expected a valid Date, got ${JSON.stringify(value)}`];
    }
    return [];
  },

  cast(field, value) {
    if (isValidDate(value)) return value;
    if (typeof value === "string" || typeof value === "number") {
      const parsed = new Date(value);
      if (isValidDate(parsed)) return parsed;
    }
    throw new CastError(`cannot cast ${JSON.stringify(value)} to date`, {
      fieldType: "date",
      value,
    });
  },
};
