import { castValue } from "../fields/cast-value.js";
import { defaultFieldTypeRegistry } from "../fields/default-registry.js";
import { ValidationError } from "./errors.js";

/**
 * Converts a `{ fieldName: value }` equality filter into a
 * `{ columnName: value }` filter suitable for Knex's `.where()`,
 * casting each value through its field's type along the way (so
 * `{ id: "1" }` matches the same rows as `{ id: 1 }` would).
 *
 * This is intentionally simple equality-only matching - the
 * Odoo-style domain DSL with AND/OR/comparison operators is Phase 8.
 * Phase 5 only needs enough filtering to make create/find/update/
 * delete usable.
 *
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {Record<string, unknown>} filter
 * @param {import('../fields/registry.js').FieldTypeRegistry} [fieldTypeRegistry]
 * @returns {Record<string, unknown>}
 * @throws {ValidationError} if `filter` references an unknown field
 */
export function mapFilterToColumns(model, filter, fieldTypeRegistry = defaultFieldTypeRegistry) {
  const columnFilter = {};

  for (const [fieldName, value] of Object.entries(filter)) {
    const field = model.fields[fieldName];
    if (!field) {
      throw new ValidationError(model.name, {
        [fieldName]: [`unknown field "${fieldName}" on model "${model.name}"`],
      });
    }
    const columnName = model.columns[fieldName];
    columnFilter[columnName] =
      value === null || value === undefined ? value : castValue(field, value, fieldTypeRegistry);
  }

  return columnFilter;
}
