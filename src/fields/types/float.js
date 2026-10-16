import { CastError } from "../errors.js";

/**
 * A floating-point number. Options:
 *   - min {number}
 *   - max {number}
 */
export const floatType = {
  name: "float",

  validateOptions(field) {
    const errors = [];
    if (field.min !== undefined && !Number.isFinite(field.min)) {
      errors.push("float field `min` must be a finite number");
    }
    if (field.max !== undefined && !Number.isFinite(field.max)) {
      errors.push("float field `max` must be a finite number");
    }
    if (
      field.min !== undefined &&
      field.max !== undefined &&
      field.min > field.max
    ) {
      errors.push("float field `min` cannot be greater than `max`");
    }
    return errors;
  },

  validate(field, value) {
    const errors = [];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      errors.push(`expected a finite number, got ${JSON.stringify(value)}`);
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
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    throw new CastError(`cannot cast ${JSON.stringify(value)} to float`, {
      fieldType: "float",
      value,
    });
  },
};
