/**
 * Resolves the default value for a field. Supports both a static
 * value (`default: "draft"`) and a factory function
 * (`default: () => new Date()`), so defaults that must be computed
 * per-record (timestamps, UUIDs) work without needing a special case
 * at every call site.
 *
 * @param {import('./define-field.js').FieldDescriptor} field
 * @returns {unknown} undefined if the field has no default configured
 */
export function defaultFor(field) {
  if (field.default === undefined) return undefined;
  if (typeof field.default === "function") return field.default();
  return field.default;
}
