import { ColumnBuilderRegistry } from "./column-builder-registry.js";

/**
 * Each builder only creates the column itself (type-specific shape).
 * Common modifiers - nullable/unique/index/default - are applied
 * uniformly afterward in build-column.js, so builders here don't
 * repeat that logic per type.
 */
export function createDefaultColumnBuilderRegistry() {
  const registry = new ColumnBuilderRegistry();

  registry.register("char", (table, columnName, field) =>
    table.string(columnName, field.maxLength ?? 255)
  );

  registry.register("text", (table, columnName) => table.text(columnName));

  registry.register("integer", (table, columnName) => table.integer(columnName));

  registry.register("float", (table, columnName) => table.float(columnName));

  registry.register("boolean", (table, columnName) => table.boolean(columnName));

  registry.register("date", (table, columnName) => table.date(columnName));

  registry.register("datetime", (table, columnName) => table.datetime(columnName));

  registry.register("json", (table, columnName) => table.json(columnName));

  registry.register("uuid", (table, columnName) => table.uuid(columnName));

  registry.register("enum", (table, columnName, field) =>
    table.enu(columnName, field.values)
  );

  return registry;
}

export const defaultColumnBuilderRegistry = createDefaultColumnBuilderRegistry();
