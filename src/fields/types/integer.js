import { CastError } from "../errors.js";

/**
 * A whole number. Options:
 *   - min {number}
 *   - max {number}
 */
export const integerType = {
  name: "integer",

  validateOptions(field) {
    const errors = [];
    if (field.min !== undefined && !Number.isFinite(field.min)) {
      errors.push("integer field `min` must be a finite number");
    }
    if (field.max !== undefined && !Number.isFinite(field.max)) {
      errors.push("integer field `max` must be a finite number");
    }
    if (
      field.min !== undefined &&
      field.max !== undefined &&
      field.min > field.max
    ) {
      errors.push("integer field `min` cannot be greater than `max`");
    }
    return errors;
  },

  validate(field, value) {
    const errors = [];
    if (typeof value !== "number" || !Number.isInteger(value)) {
      errors.push(`expected an integer, got ${JSON.stringify(value)}`);
      return errors;
    }
    if (field.min !== undefined && value < field.min) {
      errors.push(`must be >= ${field.min} (got ${value})`);
    }
    if (field.max !== undefined && value > field.max) {
      errors.push(`must be <= ${field.max} (got ${value})`);
    }
    return errors;
  },

  cast(field, value) {
    if (typeof value === "number" && Number.isInteger(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isInteger(parsed)) return parsed;
    }
    if (typeof value === "boolean") return value ? 1 : 0;
    throw new CastError(`cannot cast ${JSON.stringify(value)} to integer`, {
      fieldType: "integer",
      value,
    });
  },
};
