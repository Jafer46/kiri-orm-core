import { CastError } from "../errors.js";

const TRUTHY_STRINGS = new Set(["true", "1", "t", "yes"]);
const FALSY_STRINGS = new Set(["false", "0", "f", "no"]);

export const booleanType = {
  name: "boolean",

  validate(field, value) {
    if (typeof value !== "boolean") {
      return [`expected a boolean, got ${typeof value}`];
    }
    return [];
  },

  cast(field, value) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (value === 1) return true;
      if (value === 0) return false;
    }
    if (typeof value === "string") {
      const lower = value.trim().toLowerCase();
      if (TRUTHY_STRINGS.has(lower)) return true;
      if (FALSY_STRINGS.has(lower)) return false;
    }
    throw new CastError(`cannot cast ${JSON.stringify(value)} to boolean`, {
      fieldType: "boolean",
      value,
    });
  },
};
