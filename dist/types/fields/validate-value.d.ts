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
export declare function validateValue(field: import('./define-field.js').FieldDescriptor, value: unknown, registry?: import('./registry.js').FieldTypeRegistry): string[];
