/**
 * Adds one column to a Knex table builder for the given field, then
 * applies the modifiers common to every field type.
 *
 * Only static defaults become a DB-level DEFAULT clause. Factory
 * function defaults (`default: () => new Date()`) are a JS-side
 * concept for per-record generation (see Phase 1's defaultFor()) and
 * are deliberately NOT translated into SQL here - applying them is a
 * write-path concern for a later phase (the repository/save layer),
 * not a schema concern.
 *
 * @param {import('knex').Knex.CreateTableBuilder} table
 * @param {string} columnName
 * @param {import('../fields/define-field.js').FieldDescriptor} field
 * @param {import('./column-builder-registry.js').ColumnBuilderRegistry} [registry]
 * @returns {import('knex').Knex.ColumnBuilder}
 */
export declare function buildColumn(table: import('knex').Knex.CreateTableBuilder, columnName: string, field: import('../fields/define-field.js').FieldDescriptor, registry?: import('./column-builder-registry.js').ColumnBuilderRegistry): import('knex').Knex.ColumnBuilder;
