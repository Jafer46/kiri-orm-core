import { InvalidFieldDefinitionError } from "./errors.js";
import { defaultFieldTypeRegistry } from "./default-registry.js";

/** Options that describe a column. A computed field has none, so setting one is a mistake worth catching. */
const COLUMN_ONLY_OPTIONS = ["required", "unique", "index", "default", "column"];

/**
 * True if these raw field options declare a computed (virtual) field.
 * `compute` is the one option that decides it.
 *
 * @param {unknown} options
 */
export function isComputedField(options) {
  return options !== null && typeof options === "object" && options.compute !== undefined;
}

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
export function defineComputedField(options, registry = defaultFieldTypeRegistry) {
  if (typeof options.type !== "string" || !options.type) {
    throw new InvalidFieldDefinitionError("A computed field requires a `type` (the type of the value `compute` returns)");
  }
  registry.get(options.type); // throws a descriptive error listing the known types

  if (typeof options.compute !== "function") {
    throw new InvalidFieldDefinitionError("`compute` must be a function `(record) => value`");
  }
  if (options.store) {
    throw new InvalidFieldDefinitionError(
      "Stored computed fields (`store: true`) are not supported: a computed field is calculated when read and " +
        "never written. If you need the value persisted, use a plain field and set it yourself (for example in a beforeSave hook)."
    );
  }
  for (const option of COLUMN_ONLY_OPTIONS) {
    if (options[option] !== undefined) {
      throw new InvalidFieldDefinitionError(`\`${option}\` can't be set on a computed field: it has no column`);
    }
  }

  const depends = options.depends ?? [];
  if (!Array.isArray(depends) || depends.some((d) => typeof d !== "string" || !d)) {
    throw new InvalidFieldDefinitionError("`depends` must be an array of field names");
  }
  if (options.search !== undefined && typeof options.search !== "function") {
    throw new InvalidFieldDefinitionError("`search` must be a function `(operator, value) => domain`");
  }

  const { store, ...rest } = options; // `store: false` is accepted and simply dropped
  return Object.freeze({ ...rest, depends: Object.freeze([...new Set(depends)]) });
}
