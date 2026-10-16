import { defaultColumnBuilderRegistry } from "../schema/default-column-builders.js";
import { buildColumn } from "../schema/build-column.js";
import { addForeignKey } from "../schema/foreign-keys.js";
import { planMigrationForeignKeys } from "./foreign-keys-plan.js";
import { MigrationSafetyError } from "./errors.js";
import { describePlan } from "./describe.js";

/**
 * @typedef {Object} Migration
 * @property {(db: import('knex').Knex) => Promise<void>} up
 * @property {(db: import('knex').Knex) => Promise<void>} down
 * @property {string[]} summary - describePlan() output, for logging/review
 */

/**
 * Turns a `DiffPlan` (from diffSchema) into a reversible migration:
 * plain `up`/`down` async functions built from Knex's schema builder -
 * generated as code you can inspect before running, not a black box.
 *
 * The central safety rule for this phase: **destructive operations are
 * never included unless explicitly allowed**. If the plan drops a
 * model or a field, this throws `MigrationSafetyError` describing
 * exactly what's destructive, unless the caller passes
 * `{ allowDestructive: true }` - a conscious, one-time
 * acknowledgment, never a silent default.
 *
 * Field type changes are never auto-migrated at all, regardless of
 * `allowDestructive` - they differ too much across dialects and risk
 * silent truncation, so this always refuses until the caller resolves
 * them by hand.
 *
 * Reversibility is schema-level, not data-level: a dropped model or
 * field's `down` recreates the table/column shape (using the
 * descriptor Phase 4 stored in `_meta_fields.options`), but rows that
 * existed before the drop are gone - no migration tool can undo data
 * a DROP already committed. Renames (table, column, or field) are the
 * one case that's fully reversible with no data loss at all, since a
 * RENAME never touches the underlying values.
 *
 * @param {import('./diff.js').DiffPlan} plan
 * @param {import('../models/registry.js').ModelRegistry} modelRegistry
 * @param {Object} [options]
 * @param {boolean} [options.allowDestructive]
 * @param {import('../schema/column-builder-registry.js').ColumnBuilderRegistry} [options.columnBuilderRegistry]
 * @returns {Migration}
 * @throws {MigrationSafetyError}
 */
export function generateMigration(plan, modelRegistry, options = {}) {
  const allowDestructive = Boolean(options.allowDestructive);
  const columnBuilderRegistry = options.columnBuilderRegistry ?? defaultColumnBuilderRegistry;

  const typeChangeLines = describeTypeChanges(plan);
  if (typeChangeLines.length > 0) {
    throw new MigrationSafetyError(
      "This migration includes field type changes, which are never auto-generated " +
        "(they differ too much across dialects and risk silent truncation or data loss). " +
        "Resolve these manually before generating a migration:\n" +
        typeChangeLines.map((l) => ` - ${l}`).join("\n")
    );
  }

  const destructiveLines = describeDestructive(plan);
  if (destructiveLines.length > 0 && !allowDestructive) {
    throw new MigrationSafetyError(
      "This migration includes destructive operations that were not explicitly allowed:\n" +
        destructiveLines.map((l) => ` - ${l}`).join("\n") +
        "\nPass { allowDestructive: true } to generateMigration() to proceed, after confirming this is intended."
    );
  }

  const keys = planMigrationForeignKeys(plan, modelRegistry);

  const up = async (db) => {
    for (const rename of plan.renameModels) {
      await db.schema.renameTable(rename.fromTable, rename.toTable);
    }

    // New tables in dependency order, each with its foreign keys inside the CREATE TABLE.
    for (const model of keys.creation.order) {
      await db.schema.createTable(model.tableName, (table) => {
        for (const [fieldName, field] of Object.entries(model.fields)) {
          buildColumn(table, model.columns[fieldName], field, columnBuilderRegistry);
        }
        for (const fk of keys.creation.inline.get(model.name)) addForeignKey(table, fk);
      });
    }
    for (const { model, fk } of keys.creation.deferred) {
      await db.schema.alterTable(model.tableName, (table) => addForeignKey(table, fk));
    }

    for (const [modelName, changes] of Object.entries(plan.fieldChanges)) {
      const model = modelRegistry.getModel(modelName);
      await db.schema.alterTable(model.tableName, (table) => {
        for (const rename of changes.renameFields) {
          table.renameColumn(rename.fromColumn, rename.toColumn);
        }
        for (const rename of changes.columnRenames) {
          table.renameColumn(rename.fromColumn, rename.toColumn);
        }
        for (const fieldName of changes.addFields) {
          buildColumn(table, model.columns[fieldName], model.fields[fieldName], columnBuilderRegistry);
        }
        for (const fk of keys.added[modelName] ?? []) addForeignKey(table, fk);
        for (const drop of changes.dropFields) {
          table.dropColumn(drop.columnName);
        }
      });
    }

    for (const drop of plan.dropModels) {
      await db.schema.dropTable(drop.tableName);
    }
  };

  const down = async (db) => {
    for (const drop of [...plan.dropModels].reverse()) {
      await db.schema.createTable(drop.tableName, (table) => {
        for (const [fieldName, field] of Object.entries(drop.fields)) {
          buildColumn(table, drop.columns[fieldName], field, columnBuilderRegistry);
        }
      });
    }

    for (const [modelName, changes] of Object.entries(plan.fieldChanges).reverse()) {
      const model = modelRegistry.getModel(modelName);
      await db.schema.alterTable(model.tableName, (table) => {
        for (const drop of changes.dropFields) {
          buildColumn(table, drop.columnName, drop.field, columnBuilderRegistry);
        }
        for (const fk of keys.added[modelName] ?? []) table.dropForeign(fk.column);
        for (const fieldName of changes.addFields) {
          table.dropColumn(model.columns[fieldName]);
        }
        for (const rename of changes.columnRenames) {
          table.renameColumn(rename.toColumn, rename.fromColumn);
        }
        for (const rename of changes.renameFields) {
          table.renameColumn(rename.toColumn, rename.fromColumn);
        }
      });
    }

    for (const { model, fk } of [...keys.creation.deferred].reverse()) {
      await db.schema.alterTable(model.tableName, (table) => table.dropForeign(fk.column));
    }
    for (const model of [...keys.creation.order].reverse()) {
      await db.schema.dropTable(model.tableName);
    }

    for (const rename of [...plan.renameModels].reverse()) {
      await db.schema.renameTable(rename.toTable, rename.fromTable);
    }
  };

  return { up, down, summary: describePlan(plan) };
}

function describeDestructive(plan) {
  const lines = [];
  for (const drop of plan.dropModels) {
    lines.push(`drop model "${drop.modelName}" (table "${drop.tableName}")`);
  }
  for (const [modelName, changes] of Object.entries(plan.fieldChanges)) {
    for (const drop of changes.dropFields) {
      lines.push(`${modelName}: drop field "${drop.fieldName}" (column "${drop.columnName}")`);
    }
  }
  return lines;
}

function describeTypeChanges(plan) {
  const lines = [];
  for (const [modelName, changes] of Object.entries(plan.fieldChanges)) {
    for (const change of changes.typeChanges) {
      lines.push(`${modelName}: field "${change.fieldName}" ${change.from} -> ${change.to}`);
    }
  }
  return lines;
}
