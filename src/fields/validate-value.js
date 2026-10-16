import { defaultFieldTypeRegistry } from "./default-registry.js";

/**
 * Validates a runtime value against a field descriptor. Pure function:
 * no DB, no mutation, just field + value in, error list out.
 *
 * Handles required/null/undefined itself so individual field types
 * don't each need to reimplement that logic - a type's `validate`
 * is only ever called with a genuinely present value.
 *
 * @param {import('./define-field.js').FieldDescriptor} field
 * @param {unknown} value
 * @param {import('./registry.js').FieldTypeRegistry} [registry]
 * @returns {string[]} empty array means valid
 */
export function validateValue(field, value, registry = defaultFieldTypeRegistry) {
  const isEmpty = value === undefined || value === null;

  if (isEmpty) {
    if (field.required) {
      return ["value is required"];
    }
    return [];
  }

  const typeDef = registry.get(field.type);
  return typeDef.validate(field, value);
}
