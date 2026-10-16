import { CastError } from "../errors.js";

/**
 * A short, single-line string (maps to VARCHAR in most dialects).
 * Options:
 *   - maxLength {number} default 255
 *   - minLength {number} default 0
 */
export const charType = {
  name: "char",

  validateOptions(field) {
    const errors = [];
    const maxLength = field.maxLength ?? 255;
    if (!Number.isInteger(maxLength) || maxLength <= 0) {
      errors.push("char field `maxLength` must be a positive integer");
    }
    if (field.minLength !== undefined) {
      if (!Number.isInteger(field.minLength) || field.minLength < 0) {
        errors.push("char field `minLength` must be a non-negative integer");
      } else if (field.minLength > maxLength) {
        errors.push("char field `minLength` cannot be greater than `maxLength`");
      }
    }
    return errors;
  },

  validate(field, value) {
    const errors = [];
    if (typeof value !== "string") {
      errors.push(`expected a string, got ${typeof value}`);
      return errors;
    }
    const maxLength = field.maxLength ?? 255;
    const minLength = field.minLength ?? 0;
    if (value.length > maxLength) {
      errors.push(`must be at most ${maxLength} characters (got ${value.length})`);
    }
    if (value.length < minLength) {
      errors.push(`must be at least ${minLength} characters (got ${value.length})`);
    }
    return errors;
  },

  cast(field, value) {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    throw new CastError(`cannot cast ${typeof value} to char`, {
      fieldType: "char",
      value,
    });
  },
};
