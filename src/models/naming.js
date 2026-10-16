/**
 * Converts camelCase/PascalCase to snake_case.
 * "customerId" -> "customer_id", "OrderLine" -> "order_line",
 * "userID" -> "user_id" (acronym-aware).
 *
 * @param {string} str
 * @returns {string}
 */
export function toSnakeCase(str) {
  return str
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

/**
 * Converts snake_case to camelCase.
 * "customer_id" -> "customerId"
 *
 * @param {string} str
 * @returns {string}
 */
export function toCamelCase(str) {
  return str.replace(/_([a-z0-9])/g, (_, ch) => ch.toUpperCase());
}

/**
 * @typedef {Object} NamingStrategy
 * @property {(modelName: string) => string} modelToTable
 * @property {(fieldName: string) => string} fieldToColumn
 */

/**
 * The default naming strategy: model and field names (assumed
 * camelCase, JS-idiomatic) map to snake_case table/column names
 * (SQL-idiomatic). Table names are NOT pluralized automatically -
 * pluralization rules are inconsistent enough across languages/plurals
 * that guessing wrong silently is worse than requiring an explicit
 * `table` option when the default isn't wanted.
 *
 * @type {NamingStrategy}
 */
export const defaultNamingStrategy = {
  modelToTable: (modelName) => toSnakeCase(modelName),
  fieldToColumn: (fieldName) => toSnakeCase(fieldName),
};

/**
 * A pass-through strategy for callers who want model/field names used
 * verbatim as table/column names, with no transformation.
 *
 * @type {NamingStrategy}
 */
export const identityNamingStrategy = {
  modelToTable: (modelName) => modelName,
  fieldToColumn: (fieldName) => fieldName,
};
