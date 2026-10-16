import { mkdir, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ensureMetaTables } from "../meta/schema.js";
import { listModelsMeta } from "../meta/query.js";
import { syncMeta } from "../meta/sync-meta.js";
import { snapshotModelMeta, restoreModelMeta } from "../meta/snapshot.js";
import { buildColumn } from "../schema/build-column.js";
import { defaultColumnBuilderRegistry } from "../schema/default-column-builders.js";
import { ensurePivotTables } from "../relations/pivot-schema.js";
import { diffSchema } from "./diff.js";
import { describePlan } from "./describe.js";
import { renderMigrationSource } from "./render.js";
import { MigrationSafetyError, MigrationStateError } from "./errors.js";

/** Applied-migration history. `_meta_` is a reserved prefix, so no model's table can collide with it. */
export const MIGRATIONS_TABLE = "_meta_migrations";

const FILE_PATTERN = /^(\d{14})_([a-z0-9_]+)\.(?:js|mjs)$/;

/** @param {import('knex').Knex} db */
export async function ensureMigrationsTable(db) {
  if (await db.schema.hasTable(MIGRATIONS_TABLE)) return;
  await db.schema.createTable(MIGRATIONS_TABLE, (table) => {
    table.increments("id");
    table.string("name", 255).notNullable().unique();
    table.timestamp("applied_at").notNullable();
  });
}

/**
 * Migration files in `dir`, oldest first. Only names shaped
 * `YYYYMMDDHHMMSS_slug.js` count, so a README or editor backup file
 * in the directory is ignored rather than executed.
 *
 * @param {string} dir
 * @returns {Promise<Array<{ name: string, file: string }>>}
 */
export async function listMigrationFiles(dir) {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir);
  return entries
    .filter((entry) => FILE_PATTERN.test(entry))
    .sort()
    .map((entry) => ({ name: entry.replace(/\.(?:js|mjs)$/, ""), file: join(dir, entry) }));
}

async function loadMigration({ name, file }) {
  const mod = await import(pathToFileURL(file).href);
  if (typeof mod.up !== "function" || typeof mod.down !== "function") {
    throw new MigrationStateError(`Migration "${name}" must export async up(db) and down(db) functions (${file})`);
  }
  return mod;
}

/**
 * Reconciles files on disk with the history table.
 *
 * @param {import('knex').Knex} db
 * @param {string} dir
 * @returns {Promise<{ applied: Array<{name: string, applied_at: unknown}>, pending: Array<{name: string, file: string}> }>}
 * @throws {MigrationStateError} history and disk disagree in a way that makes the chain untrustworthy
 */
export async function getMigrationStatus(db, dir) {
  await ensureMigrationsTable(db);
  const files = await listMigrationFiles(dir);
  const applied = await db(MIGRATIONS_TABLE).orderBy("id").select("name", "applied_at");

  const onDisk = new Set(files.map((f) => f.name));
  const missing = applied.filter((row) => !onDisk.has(row.name)).map((row) => row.name);
  if (missing.length > 0) {
    throw new MigrationStateError(
      `These migrations are recorded as applied but their files are missing from ${dir}: ${missing.join(", ")}. ` +
        `Restore the files (they are needed to roll back and to trust the recorded schema state).`
    );
  }

  const appliedNames = new Set(applied.map((row) => row.name));
  const pending = files.filter((f) => !appliedNames.has(f.name));
  const lastApplied = applied.length > 0 ? applied[applied.length - 1].name : null;
  const outOfOrder = pending.filter((f) => lastApplied !== null && f.name < lastApplied);
  if (outOfOrder.length > 0) {
    throw new MigrationStateError(
      `Unapplied migration(s) ${outOfOrder.map((f) => f.name).join(", ")} sort before the latest applied one (${lastApplied}). ` +
        `Each migration records the schema state it started from, so they must be applied in order; rename the file(s) with a later timestamp.`
    );
  }
  return { applied, pending };
}

function helpers(options) {
  return { buildColumn, columnBuilderRegistry: options.columnBuilderRegistry ?? defaultColumnBuilderRegistry };
}

/**
 * Applies pending migrations, oldest first. Each one runs in its own
 * transaction together with its metadata update and its history row,
 * so a failure leaves the database, `_meta_*` and the history exactly
 * as they were before that migration.
 *
 * @param {import('knex').Knex} db
 * @param {Object} options
 * @param {string} options.dir
 * @param {number} [options.steps] - apply at most this many
 * @param {import('../schema/column-builder-registry.js').ColumnBuilderRegistry} [options.columnBuilderRegistry]
 * @param {import('../models/registry.js').ModelRegistry} [options.modelRegistry] - if given, pivot tables for its
 *   belongsToMany relations are ensured afterwards (migrations don't cover relations; see README)
 * @param {(name: string, summary: string[]) => void} [options.onApply]
 * @returns {Promise<{ applied: string[], pivotTablesCreated: string[] }>}
 */
export async function migrateUp(db, options) {
  await ensureMetaTables(db);
  const { pending } = await getMigrationStatus(db, options.dir);
  const toApply = options.steps === undefined ? pending : pending.slice(0, options.steps);

  const applied = [];
  for (const entry of toApply) {
    const migration = await loadMigration(entry);
    await db.transaction(async (trx) => {
      await migration.up(trx, helpers(options));
      for (const [modelName, snapshots] of Object.entries(migration.meta ?? {})) {
        await restoreModelMeta(trx, modelName, snapshots.after);
      }
      await trx(MIGRATIONS_TABLE).insert({ name: entry.name, applied_at: new Date() });
    });
    applied.push(entry.name);
    options.onApply?.(entry.name, migration.summary ?? []);
  }

  let pivotTablesCreated = [];
  if (options.modelRegistry && applied.length > 0) {
    // ensurePivotTables() is idempotent but reports nothing, so note which
    // pivot tables are missing first to be able to say what it created.
    const wanted = new Set();
    for (const modelName of options.modelRegistry.listModels()) {
      for (const relation of Object.values(options.modelRegistry.getModel(modelName).relations ?? {})) {
        if (relation.type === "belongsToMany") wanted.add(relation.through);
      }
    }
    for (const table of wanted) if (!(await db.schema.hasTable(table))) pivotTablesCreated.push(table);
    await ensurePivotTables(db, options.modelRegistry);
  }
  return { applied, pivotTablesCreated };
}

/**
 * Rolls back the most recently applied migrations, newest first (one,
 * unless `steps` or `all` says otherwise), each in its own transaction
 * with its metadata restored to the "before" snapshot.
 *
 * @param {import('knex').Knex} db
 * @param {Object} options
 * @param {string} options.dir
 * @param {number} [options.steps] - default 1
 * @param {boolean} [options.all]
 * @param {import('../schema/column-builder-registry.js').ColumnBuilderRegistry} [options.columnBuilderRegistry]
 * @param {(name: string, summary: string[]) => void} [options.onRollback]
 * @returns {Promise<{ rolledBack: string[] }>}
 */
export async function migrateDown(db, options) {
  await ensureMetaTables(db);
  const { applied } = await getMigrationStatus(db, options.dir);
  const count = Math.min(options.all ? applied.length : (options.steps ?? 1), applied.length);
  const toRollBack = applied.slice(applied.length - count).reverse(); // newest first

  const files = new Map((await listMigrationFiles(options.dir)).map((f) => [f.name, f]));
  const rolledBack = [];
  for (const row of toRollBack) {
    const migration = await loadMigration(files.get(row.name));
    await db.transaction(async (trx) => {
      await migration.down(trx, helpers(options));
      for (const [modelName, snapshots] of Object.entries(migration.meta ?? {})) {
        await restoreModelMeta(trx, modelName, snapshots.before);
      }
      await trx(MIGRATIONS_TABLE).where({ name: row.name }).delete();
    });
    rolledBack.push(row.name);
    options.onRollback?.(row.name, migration.summary ?? []);
  }
  return { rolledBack };
}

class DryRunRollback extends Error {}

/**
 * What `_meta_*` would look like for each model after
 * `syncMeta(registry)`, without keeping any of it: the sync runs in a
 * transaction that is rolled back once the snapshots are taken. Going
 * through the real syncMeta (rather than re-deriving rows from the
 * registry) means the "after" state in a migration is by construction
 * what the rest of the ORM would have recorded.
 */
async function previewMetaAfterSync(db, modelRegistry, modelNames) {
  const after = {};
  try {
    await db.transaction(async (trx) => {
      await syncMeta(trx, modelRegistry);
      for (const name of modelNames) after[name] = await snapshotModelMeta(trx, name);
      throw new DryRunRollback();
    });
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
  }
  return after;
}

const isEmptyPlan = (plan) =>
  plan.createModels.length === 0 &&
  plan.dropModels.length === 0 &&
  plan.renameModels.length === 0 &&
  Object.keys(plan.fieldChanges).length === 0;

function timestampAfter(existingNames, now = new Date()) {
  const stamp = (date) => date.toISOString().replace(/\D/g, "").slice(0, 14);
  let date = now;
  const latest = existingNames.map((name) => name.slice(0, 14)).sort().pop();
  while (latest !== undefined && stamp(date) <= latest) date = new Date(date.getTime() + 1000);
  return stamp(date);
}

function defaultSlug(plan) {
  const created = plan.createModels;
  if (created.length > 0 && created.length <= 3 && Object.keys(plan.fieldChanges).length === 0 && plan.dropModels.length === 0) {
    return `create_${created.join("_")}`;
  }
  return "schema_changes";
}

/**
 * Diffs the registry against the recorded schema state and, if there
 * are changes, writes a migration file for them.
 *
 * Refuses while unapplied migrations exist: the diff is against the
 * *applied* state, so generating on top of pending migrations would
 * write the same changes into a second file.
 *
 * @param {import('knex').Knex} db
 * @param {import('../models/registry.js').ModelRegistry} modelRegistry
 * @param {Object} options
 * @param {string} options.dir
 * @param {string} [options.name] - slug for the file name
 * @param {boolean} [options.dryRun] - compute and return the plan, write nothing
 * @param {boolean} [options.allowDestructive]
 * @param {Record<string, string>} [options.modelRenames]
 * @param {Record<string, Record<string, string>>} [options.fieldRenames]
 * @returns {Promise<{ plan: object, summary: string[], file: string|null, name: string|null }>}
 *   `file` is null when there is nothing to write (no changes, or a dry run)
 * @throws {MigrationStateError} pending migrations exist
 * @throws {MigrationSafetyError} destructive changes not allowed / type changes; carries `planLines`
 */
export async function generateMigrationFile(db, modelRegistry, options) {
  await ensureMetaTables(db);
  const { pending } = await getMigrationStatus(db, options.dir);
  if (pending.length > 0) {
    throw new MigrationStateError(
      `${pending.length} migration(s) have not been applied yet (${pending.map((p) => p.name).join(", ")}). ` +
        `Apply them first - a new migration is generated against the applied schema state, ` +
        `so generating now would repeat their changes.`
    );
  }

  const plan = await diffSchema(db, modelRegistry, {
    modelRenames: options.modelRenames,
    fieldRenames: options.fieldRenames,
  });
  const summary = describePlan(plan);
  if (isEmptyPlan(plan)) return { plan, summary, file: null, name: null };

  // Snapshot the touched models' metadata before and after.
  const previousNames = (await listModelsMeta(db, { includeRemoved: true })).map((row) => row.name);
  const names = [...new Set([...previousNames, ...modelRegistry.listModels()])];
  const after = await previewMetaAfterSync(db, modelRegistry, names);
  const meta = {};
  for (const name of names) {
    const before = await snapshotModelMeta(db, name);
    if (JSON.stringify(before) !== JSON.stringify(after[name])) meta[name] = { before, after: after[name] };
  }

  let source;
  try {
    source = renderMigrationSource(plan, modelRegistry, { allowDestructive: options.allowDestructive, meta });
  } catch (error) {
    if (error instanceof MigrationSafetyError) error.planLines = summary;
    throw error;
  }
  if (options.dryRun) return { plan, summary, file: null, name: null };

  const existing = await listMigrationFiles(options.dir);
  const slug = (options.name ?? defaultSlug(plan)).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "schema_changes";
  const name = `${timestampAfter(existing.map((f) => f.name))}_${slug}`;
  const file = join(options.dir, `${name}.js`);
  await mkdir(options.dir, { recursive: true });
  await writeFile(file, source, { flag: "wx" });
  return { plan, summary, file, name };
}
