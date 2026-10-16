import { META_MODELS_TABLE, META_FIELDS_TABLE } from "./reserved-tables.js";

/**
 * Creates the two internal metadata tables if they don't already
 * exist. Idempotent, same spirit as Phase 3's additive sync() - safe
 * to call on every sync().
 *
 * `_meta_models` - one row per registered model (name, resolved table
 * name, lifecycle timestamps).
 *
 * `_meta_fields` - one row per field on a model (name, resolved
 * column name, type, constraints, and the full field descriptor as
 * JSON for fidelity). Denormalizes the model name onto each row
 * (alongside the `model_id` FK) specifically so a flat query like
 * `SELECT * FROM _meta_fields WHERE model = 'invoice'` works without
 * a join - that ergonomic is the whole point of this phase.
 *
 * @param {import('knex').Knex} db
 */
export async function ensureMetaTables(db) {
  const hasModels = await db.schema.hasTable(META_MODELS_TABLE);
  if (!hasModels) {
    await db.schema.createTable(META_MODELS_TABLE, (table) => {
      table.increments("id");
      table.string("name", 255).notNullable().unique();
      table.string("table_name", 255).notNullable().unique();
      table.timestamp("created_at").notNullable();
      table.timestamp("updated_at").notNullable();
      table.timestamp("removed_at").nullable();
    });
  }

  const hasFields = await db.schema.hasTable(META_FIELDS_TABLE);
  if (!hasFields) {
    await db.schema.createTable(META_FIELDS_TABLE, (table) => {
      table.increments("id");
      table
        .integer("model_id")
        .notNullable()
        .references("id")
        .inTable(META_MODELS_TABLE);
      table.string("model", 255).notNullable();
      table.string("name", 255).notNullable();
      table.string("column", 255).notNullable();
      table.string("type", 100).notNullable();
      table.boolean("required").notNullable().defaultTo(false);
      table.boolean("is_unique").notNullable().defaultTo(false);
      table.boolean("is_indexed").notNullable().defaultTo(false);
      table.json("options").nullable();
      table.timestamp("created_at").notNullable();
      table.timestamp("updated_at").notNullable();
      table.timestamp("removed_at").nullable();
      table.unique(["model_id", "name"]);
      table.index("model");
    });
  }
}
