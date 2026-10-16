/**
 * Converts camelCase/PascalCase to snake_case.
 * "customerId" -> "customer_id", "OrderLine" -> "order_line",
 * "userID" -> "user_id" (acronym-aware).
 *
 * @param {string} str
 * @returns {string}
 */
export declare function toSnakeCase(str: string): string;
/**
 * Converts snake_case to camelCase.
 * "customer_id" -> "customerId"
 *
 * @param {string} str
 * @returns {string}
 */
export declare function toCamelCase(str: string): string;
export type NamingStrategy = {
    modelToTable: (modelName: string) => string;
    fieldToColumn: (fieldName: string) => string;
};
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
export declare const defaultNamingStrategy: NamingStrategy;
/**
 * A pass-through strategy for callers who want model/field names used
 * verbatim as table/column names, with no transformation.
 *
 * @type {NamingStrategy}
 */
export declare const identityNamingStrategy: NamingStrategy;
