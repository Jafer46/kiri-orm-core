import { addForeignKey } from "../schema/foreign-keys.js";
import { pivotForeignKeysOf } from "./foreign-keys.js";
import { resolveLocalKey } from "./keys.js";
import { primaryKeyOf } from "../models/primary-key.js";
import { defaultColumnBuilderRegistry } from "../schema/default-column-builders.js";

/**
 * Creates the pivot table for every `belongsToMany` relation across
 * every registered model, if it doesn't already exist. Same spirit as
 * Phase 3's additive sync(): create-if-missing, never alter or drop,
 * safe to call on every sync().
 *
 * The pivot table is intentionally minimal - just the two foreign-key
 * columns plus a composite unique constraint preventing the same pair
 * from being associated twice. No surrogate `id` column, since
 * nothing needs to reference a pivot row individually for Phase 7's
 * scope (association metadata like "when was this tag added" is a
 * reasonable future extension, not attempted here).
 *
 * If two different relations (possibly on different models) declare
 * the same `through` table name, the table is only created once - its
 * columns are whatever the first relation to be processed specifies.
 * Declaring the same pivot table with different column names across
 * relations is a modeling error the caller needs to avoid; this
 * function doesn't attempt to detect or reconcile that mismatch.
 *
 * @param {import('knex').Knex} db
 * @param {import('../models/registry.js').ModelRegistry} modelRegistry
 */
export async function ensurePivotTables(db, modelRegistry, columnBuilderRegistry = defaultColumnBuilderRegistry) {
  for (const modelName of modelRegistry.listModels()) {
    const model = modelRegistry.getModel(modelName);
    for (const relation of Object.values(model.relations ?? {})) {
      if (relation.type !== "belongsToMany") continue;

      const exists = await db.schema.hasTable(relation.through);
      if (exists) continue;

      await db.schema.createTable(relation.through, (table) => {
        const related = modelRegistry.listModels().includes(relation.model) ? modelRegistry.getModel(relation.model) : null;
        pivotColumn(table, relation.foreignKey, model.fields?.[resolveLocalKey(relation, model)], columnBuilderRegistry);
        pivotColumn(table, relation.otherKey, related && related.fields?.[primaryKeyOf(related)], columnBuilderRegistry);
        table.unique([relation.foreignKey, relation.otherKey]);
        // both sides cascade: deleting a row removes its associations, in the database
        for (const fk of pivotForeignKeysOf(modelRegistry, model, relation)) addForeignKey(table, fk);
      });
    }
  }
}

/**
 * A pivot column of the same type as the key it points to. Before 0.1.7 both pivot columns
 * were always `integer`: with uuid (or char) keys, Postgres refused to create the foreign key
 * ("incompatible types"), so syncModels() failed; SQLite silently stored the uuids in
 * integer-typed columns. Existing pivot tables are never altered - only new ones get this.
 *
 * An auto-increment key is an integer column; any other key is built by the same column builder
 * as the key itself (uuid -> uuid, char -> varchar of its maxLength, ...), without the key's own
 * primary/unique/default. A key that can't be resolved falls back to `integer`, as before.
 */
function pivotColumn(table, columnName, keyField, columnBuilderRegistry) {
  if (!keyField || keyField.autoId === "increment" || !columnBuilderRegistry.has?.(keyField.type)) {
    return table.integer(columnName).notNullable();
  }
  return columnBuilderRegistry.get(keyField.type)(table, columnName, keyField).notNullable();
}
