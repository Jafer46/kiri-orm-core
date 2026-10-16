/**
 * Converts one field descriptor (Phase 1) into a JSON Schema
 * fragment. Pure data transformation - no DB, no compiler, just the
 * field object that already exists at runtime. This is the whole
 * point of not depending on TypeScript's type system for this: the
 * schema IS the source of truth already, so generating a JSON Schema
 * from it is just reading properties off an object.
 *
 * @param {import('../fields/define-field.js').FieldDescriptor} field
 * @returns {object}
 */
export function fieldToJsonSchema(field) {
  switch (field.type) {
    case "char":
    case "text": {
      const schema = { type: "string" };
      if (field.maxLength !== undefined) schema.maxLength = field.maxLength;
      if (field.minLength !== undefined) schema.minLength = field.minLength;
      return schema;
    }
    case "integer": {
      const schema = { type: "integer" };
      if (field.min !== undefined) schema.minimum = field.min;
      if (field.max !== undefined) schema.maximum = field.max;
      return schema;
    }
    case "float": {
      const schema = { type: "number" };
      if (field.min !== undefined) schema.minimum = field.min;
      if (field.max !== undefined) schema.maximum = field.max;
      return schema;
    }
    case "boolean":
      return { type: "boolean" };
    case "date":
      return { type: "string", format: "date" };
    case "datetime":
      return { type: "string", format: "date-time" };
    case "json":
      // Deliberately unconstrained - a json field can hold any
      // JSON-serializable value, and Phase 1 never restricted its
      // shape further than that.
      return {};
    case "enum":
      return { type: "string", enum: [...field.values] };
    default:
      // A custom/plugin field type (Phase 1's registry is
      // extensible) with no known JSON Schema mapping - fall back to
      // unconstrained rather than throwing, since refusing to
      // generate a DTO at all for one unknown field type would be a
      // worse failure mode than one imprecise property.
      return {};
  }
}
