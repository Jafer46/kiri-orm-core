import { defaultColumnBuilderRegistry } from "./default-column-builders.js";

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
export function buildColumn(table, columnName, field, registry = defaultColumnBuilderRegistry) {
  // The primary key column. An auto-increment integer key is the database's own
  // increments() column (integer + primary + not null); any other key is built
  // normally and then made a real PRIMARY KEY, which already implies unique.
  // `primary` is set by defineModel(). A descriptor without the flag (one recorded
  // before primary keys were declarable) falls back to the old convention: `id`.
  const isPrimary = field.primary === undefined ? columnName === "id" : field.primary === true;
  if (isPrimary) {
    if (field.autoId === "increment") return table.increments(columnName);
    let idColumn = registry.get(field.type)(table, columnName, field).primary();
    if (field.default !== undefined && typeof field.default !== "function") idColumn = idColumn.defaultTo(field.default);
    return idColumn;
  }

  const buildFn = registry.get(field.type);
  let column = buildFn(table, columnName, field);

  column = field.required ? column.notNullable() : column.nullable();
  if (field.unique) column = column.unique();
  if (field.index) column = column.index();
  if (field.default !== undefined && typeof field.default !== "function") {
    column = column.defaultTo(field.default);
  }

  return column;
}
