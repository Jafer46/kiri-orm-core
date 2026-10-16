import { defaultFieldTypeRegistry } from "./default-registry.js";

/**
 * Coerces a runtime value into a field's canonical JS representation
 * (e.g. numeric string -> number, "true" -> boolean). Pure function:
 * no DB, no mutation.
 *
 * null/undefined pass through unchanged - casting is only concerned
 * with type coercion, not presence, which is validateValue()'s job.
 * Deliberately does NOT call validateValue() internally: callers that
 * want both should call validate then cast, so cast failures and
 * validation failures stay distinguishable (CastError vs an error
 * list) rather than being silently merged.
 *
 * @param {import('./define-field.js').FieldDescriptor} field
 * @param {unknown} value
 * @param {import('./registry.js').FieldTypeRegistry} [registry]
 * @returns {unknown}
 * @throws {import('./errors.js').CastError} if value cannot be coerced
 */
export function castValue(field, value, registry = defaultFieldTypeRegistry) {
  if (value === undefined || value === null) return value;

  const typeDef = registry.get(field.type);
  return typeDef.cast(field, value);
}
