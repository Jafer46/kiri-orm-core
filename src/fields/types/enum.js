import { CastError } from "../errors.js";

/**
 * A value constrained to a fixed set of options. Requires a `values`
 * array on the field descriptor, e.g.:
 *   { type: "enum", values: ["draft", "sent", "paid"] }
 */
export const enumType = {
  name: "enum",

  validateOptions(field) {
    const errors = [];
    if (!Array.isArray(field.values) || field.values.length === 0) {
      errors.push("enum field requires a non-empty `values` array");
      return errors;
    }
    const allStrings = field.values.every((v) => typeof v === "string");
    if (!allStrings) {
      errors.push("enum field `values` must all be strings");
    }
    const unique = new Set(field.values).size === field.values.length;
    if (!unique) {
      errors.push("enum field `values` must not contain duplicates");
    }
    return errors;
  },

  validate(field, value) {
    if (typeof value !== "string" || !field.values.includes(value)) {
      return [
        `expected one of [${field.values.join(", ")}], got ${JSON.stringify(value)}`,
      ];
    }
    return [];
  },

  cast(field, value) {
    if (typeof value === "string" && field.values.includes(value)) {
      return value;
    }
    throw new CastError(
      `cannot cast ${JSON.stringify(value)} to enum(${field.values.join(", ")})`,
      { fieldType: "enum", value }
    );
  },
};
