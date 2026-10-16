/** Applied-migration history. `_meta_` is a reserved prefix, so no model's table can collide with it. */
export declare const MIGRATIONS_TABLE = "_meta_migrations";
/** @param {import('knex').Knex} db */
export declare function ensureMigrationsTable(db: import('knex').Knex): Promise<void>;
/**
 * Migration files in `dir`, oldest first. Only names shaped
 * `YYYYMMDDHHMMSS_slug.js` count, so a README or editor backup file
 * in the directory is ignored rather than executed.
 *
 * @param {string} dir
 * @returns {Promise<Array<{ name: string, file: string }>>}
 */
export declare function listMigrationFiles(dir: string): Promise<Array<{
    name: string;
    file: string;
}>>;
/**
 * Reconciles files on disk with the history table.
 *
 * @param {import('knex').Knex} db
 * @param {string} dir
 * @returns {Promise<{ applied: Array<{name: string, applied_at: unknown}>, pending: Array<{name: string, file: string}> }>}
 * @throws {MigrationStateError} history and disk disagree in a way that makes the chain untrustworthy
 */
export declare function getMigrationStatus(db: import('knex').Knex, dir: string): Promise<{
    applied: Array<{
        name: string;
        applied_at: unknown;
    }>;
    pending: Array<{
        name: string;
        file: string;
    }>;
}>;
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
export declare function migrateUp(db: import('knex').Knex, options: {
    dir: string;
    steps?: number;
    columnBuilderRegistry?: import('../schema/column-builder-registry.js').ColumnBuilderRegistry;
    modelRegistry?: import('../models/registry.js').ModelRegistry;
    onApply?: (name: string, summary: string[]) => void;
}): Promise<{
    applied: string[];
    pivotTablesCreated: string[];
}>;
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
export declare function migrateDown(db: import('knex').Knex, options: {
    dir: string;
    steps?: number;
    all?: boolean;
    columnBuilderRegistry?: import('../schema/column-builder-registry.js').ColumnBuilderRegistry;
    onRollback?: (name: string, summary: string[]) => void;
}): Promise<{
    rolledBack: string[];
}>;
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
export declare function generateMigrationFile(db: import('knex').Knex, modelRegistry: import('../models/registry.js').ModelRegistry, options: {
    dir: string;
    name?: string;
    dryRun?: boolean;
    allowDestructive?: boolean;
    modelRenames?: Record<string, string>;
    fieldRenames?: Record<string, Record<string, string>>;
}): Promise<{
    plan: object;
    summary: string[];
    file: string | null;
    name: string | null;
}>;
