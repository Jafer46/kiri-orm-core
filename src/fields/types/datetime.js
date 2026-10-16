import { CastError } from "../errors.js";

function isValidDate(d) {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

/**
 * A date + time value. Kept as a separate type from `date` (rather than
 * an option on it) so the future schema-sync layer can map them to
 * distinct column types (DATE vs TIMESTAMP) per dialect without
 * inspecting field options.
 */
export const datetimeType = {
  name: "datetime",

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
    throw new CastError(`cannot cast ${JSON.stringify(value)} to datetime`, {
      fieldType: "datetime",
      value,
    });
  },
};
