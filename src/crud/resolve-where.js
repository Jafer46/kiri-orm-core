import { mapFilterToColumns } from "./map-filter.js";
import { compileDomain } from "../domain/compile.js";

/**
 * Resolves a `Repository` filter into whatever Knex's `.where()`
 * expects. An array is treated as a domain (Phase 8); anything else
 * (a plain object) is treated as the simple equality filter Phase 5
 * already supported. Both return values work identically as an
 * argument to Knex's `.where()` - a plain object (AND-equality across
 * its keys) or a callback function - so callers can use `.where(resolveWhere(...))`
 * without needing to know which shape they got.
 *
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {Record<string, unknown>|unknown[]} filter
 * @param {import('../fields/registry.js').FieldTypeRegistry} fieldTypeRegistry
 * @param {import('../models/registry.js').ModelRegistry} [modelRegistry] - required for domains that traverse a relation
 */
export function resolveWhere(model, filter, fieldTypeRegistry, modelRegistry) {
  if (Array.isArray(filter)) {
    return compileDomain(model, filter, fieldTypeRegistry, modelRegistry);
  }
  // A plain-object filter is column equality, which a computed field has no
  // column for. If it names one, express the whole filter as the equivalent
  // domain (`{ a: 1, fullName: "x" }` -> [["a","=",1], ["fullName","=","x"]])
  // so the computed field's search() can translate its part.
  if (model.computed && Object.keys(filter).some((key) => Object.prototype.hasOwnProperty.call(model.computed, key))) {
    const domain = Object.entries(filter).map(([field, value]) => [field, "=", value]);
    return compileDomain(model, domain, fieldTypeRegistry, modelRegistry);
  }
  return mapFilterToColumns(model, filter, fieldTypeRegistry);
}

/**
 * True if `filter` is "empty" in the sense that it would match every
 * row - an empty object `{}` or an empty domain array `[]`. Used by
 * update()/delete() to refuse an accidental all-rows operation
 * regardless of which filter style was used.
 *
 * @param {Record<string, unknown>|unknown[]} filter
 */
export function isEmptyFilter(filter) {
  if (Array.isArray(filter)) return filter.length === 0;
  return !filter || Object.keys(filter).length === 0;
}
