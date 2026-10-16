import { CastError } from "../errors.js";

/**
 * Long-form text (maps to TEXT in most dialects). Unlike `char`, there
 * is no default length cap - set `maxLength` explicitly if you want one.
 */
export const textType = {
  name: "text",

  validateOptions(field) {
    const errors = [];
    if (field.maxLength !== undefined) {
      if (!Number.isInteger(field.maxLength) || field.maxLength <= 0) {
        errors.push("text field `maxLength` must be a positive integer when set");
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
    if (field.maxLength !== undefined && value.length > field.maxLength) {
      errors.push(`must be at most ${field.maxLength} characters (got ${value.length})`);
    }
    return errors;
  },

  cast(field, value) {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    throw new CastError(`cannot cast ${typeof value} to text`, {
      fieldType: "text",
      value,
    });
  },
};
