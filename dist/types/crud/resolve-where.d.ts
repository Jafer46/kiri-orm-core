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
export declare function resolveWhere(model: import('../models/define-model.js').ModelDescriptor, filter: Record<string, unknown> | unknown[], fieldTypeRegistry: import('../fields/registry.js').FieldTypeRegistry, modelRegistry?: import('../models/registry.js').ModelRegistry): Record<string, unknown> | ((qb: import('knex').Knex.QueryBuilder) => void);
/**
 * True if `filter` is "empty" in the sense that it would match every
 * row - an empty object `{}` or an empty domain array `[]`. Used by
 * update()/delete() to refuse an accidental all-rows operation
 * regardless of which filter style was used.
 *
 * @param {Record<string, unknown>|unknown[]} filter
 */
export declare function isEmptyFilter(filter: Record<string, unknown> | unknown[]): boolean;
