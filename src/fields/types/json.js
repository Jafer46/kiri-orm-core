import { CastError } from "../errors.js";

function isJsonSerializable(value) {
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Any JSON-serializable value (object, array, or primitive). Maps to a
 * JSON/JSONB column depending on dialect in a later phase.
 */
export const jsonType = {
  name: "json",

  validate(field, value) {
    if (value === undefined) {
      return ["expected a JSON-serializable value, got undefined"];
    }
    if (!isJsonSerializable(value)) {
      return ["value is not JSON-serializable (e.g. contains a circular reference)"];
    }
    return [];
  },

  cast(field, value) {
    if (isJsonSerializable(value)) return value;
    throw new CastError(`cannot cast value to json: not JSON-serializable`, {
      fieldType: "json",
      value,
    });
  },
};
