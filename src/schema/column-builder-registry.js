import { SchemaSyncError } from "./errors.js";

/**
 * @typedef {(table: import('knex').Knex.CreateTableBuilder, columnName: string, field: object) => import('knex').Knex.ColumnBuilder} ColumnBuilderFn
 */

/**
 * Holds field-type -> Knex column-builder mappings. Kept separate from
 * the field type registry (Phase 1) because "how do I validate/cast
 * this value in JS" and "what SQL column does this become" are
 * different concerns - a field type can exist without ever being
 * persisted (a purely computed field, added in a later phase), and a
 * plugin adding a new field type needs to supply both independently.
 *
 * A class rather than a bare object so custom/plugin field types can
 * register their own column builder without mutating a shared global,
 * matching the pattern used by FieldTypeRegistry and ModelRegistry.
 */
export class ColumnBuilderRegistry {
  #builders = new Map();

  /**
   * @param {string} fieldType
   * @param {ColumnBuilderFn} buildFn
   */
  register(fieldType, buildFn) {
    if (typeof fieldType !== "string" || !fieldType) {
      throw new SchemaSyncError("Column builder registration requires a non-empty field type name");
    }
    if (typeof buildFn !== "function") {
      throw new SchemaSyncError(`Column builder for "${fieldType}" must be a function`);
    }
    this.#builders.set(fieldType, buildFn);
    return this;
  }

  /**
   * @param {string} fieldType
   * @returns {ColumnBuilderFn}
   */
  get(fieldType) {
    const fn = this.#builders.get(fieldType);
    if (!fn) {
      throw new SchemaSyncError(
        `No column builder registered for field type "${fieldType}". ` +
          `Registered types: ${[...this.#builders.keys()].join(", ") || "(none)"}`
      );
    }
    return fn;
  }

  has(fieldType) {
    return this.#builders.has(fieldType);
  }
}
