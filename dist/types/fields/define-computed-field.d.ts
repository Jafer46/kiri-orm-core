/**
 * True if these raw field options declare a computed (virtual) field.
 * `compute` is the one option that decides it.
 *
 * @param {unknown} options
 */
export declare function isComputedField(options: unknown): boolean;
export type ComputedFieldDescriptor = {
    /**
     * - the type of the value `compute` returns (used for casting search values and for DTOs)
     */
    type: string;
    compute: (record: Record<string, unknown>) => unknown;
    /**
     * - fields of the same model `compute` reads
     */
    depends: readonly string[];
    search: ((operator: string, value: unknown) => unknown[]) | undefined;
};
/**
 * @typedef {Object} ComputedFieldDescriptor
 * @property {string} type - the type of the value `compute` returns (used for casting search values and for DTOs)
 * @property {(record: Record<string, unknown>) => unknown} compute
 * @property {readonly string[]} depends - fields of the same model `compute` reads
 * @property {((operator: string, value: unknown) => unknown[])|undefined} search
 */
/**
 * Defines a computed field: a value calculated from a record's other
 * fields when it is read, never stored.
 *
 *   fullName: {
 *     type: "char",
 *     depends: ["firstName", "lastName"],
 *     compute: (record) => `${record.firstName} ${record.lastName}`,
 *     // What makes it queryable - see compileComputedLeaf() in domain/compile.js:
 *     search: (operator, value) => [["firstName", operator, value]],
 *   }
 *
 * `compute` must be synchronous and a pure function of `record`. It
 * runs on every access (there's no cache to go stale when a field is
 * edited in memory), so it should be cheap.
 *
 * `search(operator, value)` is Odoo's compute-and-search pattern: given
 * a comparison on the computed field, return a domain over fields that
 * DO exist as columns (or other computed fields) that selects the same
 * records. Without it the field can be read but not filtered on.
 *
 * Stored computed fields (`store: true`) are deliberately not supported:
 * they'd need recomputation whenever a dependency changes - through
 * update(), updateMany(), createMany(), and raw SQL - and a missed path
 * silently leaves stale data in a column that queries trust.
 *
 * @param {Record<string, unknown>} options
 * @param {import('./registry.js').FieldTypeRegistry} [registry]
 * @returns {Readonly<ComputedFieldDescriptor>}
 */
export declare function defineComputedField(options: Record<string, unknown>, registry?: import('./registry.js').FieldTypeRegistry): Readonly<ComputedFieldDescriptor>;
