import { defaultColumnBuilderRegistry } from "./default-column-builders.js";
import { buildColumn } from "./build-column.js";
import { ensureMetaTables } from "../meta/schema.js";
import { syncMeta } from "../meta/sync-meta.js";
import { ensurePivotTables } from "../relations/pivot-schema.js";
import { foreignKeysOf } from "../relations/foreign-keys.js";
import { addForeignKey, planCreation } from "./foreign-keys.js";
import { ensureSqliteForeignKeys, listForeignKeys } from "./introspect-foreign-keys.js";

/**
 * @typedef {Object} SyncResult
 * @property {string[]} tablesCreated
 * @property {Record<string, string[]>} columnsAdded - tableName -> column names added
 * @property {string[]} foreignKeysAdded - e.g. "post.author_id -> user.id"
 * @property {string[]} warnings - things sync() didn't change but you should know about
 * @property {import('../meta/sync-meta.js').MetaSyncResult} meta
 */

/**
 * Syncs every model registered on `modelRegistry` to real tables in
 * `db`. Additive-only: creates tables/columns that don't exist yet,
 * never drops or alters existing ones. Safe to call repeatedly -
 * running it twice in a row with no model changes is a no-op on the
 * second call (idempotent).
 *
 * This is deliberately simple for Phase 3. Real migration files with
 * diffing, renames, and reversibility come in Phase 6, once the
 * DB-persisted metamodel from Phase 4 exists to diff against - trying
 * to detect renames vs drop+add from live schema introspection alone
 * is exactly the kind of guess that goes wrong silently, so it's not
 * attempted here.
 *
 * As of Phase 4, sync() also ensures the `_meta_models`/`_meta_fields`
 * tables exist and upserts them to reflect the current registry state
 * (see the `meta` module), so the schema stays queryable as data.
 *
 * As of Phase 7, sync() also ensures the pivot table for every
 * `belongsToMany` relation exists (see the `relations` module).
 *
 * Every `belongsTo` relation becomes a real FOREIGN KEY with its `onDelete` action, so the
 * database - not the ORM - enforces referential integrity. New tables are created in
 * dependency order so each key points at a table that exists. A table that already exists
 * is not altered, except for the columns it's missing (which bring their keys with them);
 * existing foreign key columns that lack their constraint are reported in `warnings`, and
 * added when `addMissingForeignKeys` is set (this can fail if rows already violate it).
 *
 * @param {import('knex').Knex} db
 * @param {import('../models/registry.js').ModelRegistry} modelRegistry
 * @param {Object} [options]
 * @param {import('./column-builder-registry.js').ColumnBuilderRegistry} [options.columnBuilderRegistry]
 * @param {boolean} [options.addMissingForeignKeys] - add constraints that existing tables lack
 * @returns {Promise<SyncResult>}
 */
export async function sync(db, modelRegistry, options = {}) {
  modelRegistry.assertResolved();
  const columnBuilderRegistry = options.columnBuilderRegistry ?? defaultColumnBuilderRegistry;

  /** @type {SyncResult} */
  const result = { tablesCreated: [], columnsAdded: {}, foreignKeysAdded: [], warnings: [] };
  const describeKey = (table, fk) => `${table}.${fk.column} -> ${fk.refTable}.${fk.refColumn}`;

  if ((await ensureSqliteForeignKeys(db)) === false) {
    result.warnings.push(
      "SQLite foreign key enforcement is OFF on this connection (PRAGMA foreign_keys), so the constraints created " +
        "here will not be enforced. Connections made by createConnection() enable it; for your own, add " +
        "`pool: { afterCreate: (conn, done) => { conn.pragma(\"foreign_keys = ON\"); done(null, conn); } }`."
    );
  }

  const models = modelRegistry.listModels().map((name) => modelRegistry.getModel(name));
  const foreignKeysFor = (model) => foreignKeysOf(modelRegistry, model);
  const toCreate = [];
  const existing = [];
  for (const model of models) ((await db.schema.hasTable(model.tableName)) ? existing : toCreate).push(model);

  // New tables, in dependency order, each with its foreign keys inside the CREATE TABLE.
  const plan = planCreation(toCreate, foreignKeysFor);
  for (const model of plan.order) {
    const inline = plan.inline.get(model.name);
    await db.schema.createTable(model.tableName, (table) => {
      for (const [fieldName, field] of Object.entries(model.fields)) {
        buildColumn(table, model.columns[fieldName], field, columnBuilderRegistry);
      }
      for (const fk of inline) addForeignKey(table, fk);
    });
    for (const fk of inline) result.foreignKeysAdded.push(describeKey(model.tableName, fk));
  }
  // A cycle (a -> b -> a) can't be satisfied inside the CREATE TABLEs: add those keys now.
  for (const { model, fk } of plan.deferred) {
    await db.schema.alterTable(model.tableName, (table) => addForeignKey(table, fk));
    result.foreignKeysAdded.push(describeKey(model.tableName, fk));
  }
  const created = new Set(toCreate.map((m) => m.name));
  result.tablesCreated = models.filter((m) => created.has(m.name)).map((m) => m.tableName);

  // Existing tables: add missing columns (with their keys); report keys the table never got.
  for (const model of existing) {
    const existingColumns = await db(model.tableName).columnInfo();
    const missingFieldEntries = Object.entries(model.fields).filter(
      ([fieldName]) => !(model.columns[fieldName] in existingColumns)
    );
    const addedColumns = new Set(missingFieldEntries.map(([fieldName]) => model.columns[fieldName]));
    const wanted = foreignKeysFor(model);

    if (missingFieldEntries.length > 0) {
      const withNewColumn = wanted.filter((fk) => addedColumns.has(fk.column));
      await db.schema.alterTable(model.tableName, (table) => {
        for (const [fieldName, field] of missingFieldEntries) {
          buildColumn(table, model.columns[fieldName], field, columnBuilderRegistry);
        }
        for (const fk of withNewColumn) addForeignKey(table, fk);
      });
      result.columnsAdded[model.tableName] = [...addedColumns];
      for (const fk of withNewColumn) result.foreignKeysAdded.push(describeKey(model.tableName, fk));
    }

    const present = await listForeignKeys(db, model.tableName);
    if (present === null) continue; // a dialect we can't introspect
    const missing = wanted.filter((fk) => !addedColumns.has(fk.column) && !present.some((p) => p.column === fk.column && p.refTable === fk.refTable));
    for (const fk of missing) {
      if (options.addMissingForeignKeys) {
        await db.schema.alterTable(model.tableName, (table) => addForeignKey(table, fk));
        result.foreignKeysAdded.push(describeKey(model.tableName, fk));
      } else {
        result.warnings.push(
          `${describeKey(model.tableName, fk)} has no foreign key in the database (the table predates foreign keys), ` +
            `so onDelete: "${fk.onDelete.toLowerCase()}" is not enforced for it. Run sync with { addMissingForeignKeys: true } to add it.`
        );
      }
    }
  }

  await ensurePivotTables(db, modelRegistry);
  await ensureMetaTables(db);
  result.meta = await syncMeta(db, modelRegistry);

  return result;
}
