export type ColumnBuilderFn = (table: import('knex').Knex.CreateTableBuilder, columnName: string, field: object) => import('knex').Knex.ColumnBuilder;
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
export declare class ColumnBuilderRegistry {
    #private;
    /**
     * @param {string} fieldType
     * @param {ColumnBuilderFn} buildFn
     */
    register(fieldType: string, buildFn: ColumnBuilderFn): this;
    /**
     * @param {string} fieldType
     * @returns {ColumnBuilderFn}
     */
    get(fieldType: string): ColumnBuilderFn;
    has(fieldType: any): boolean;
}
