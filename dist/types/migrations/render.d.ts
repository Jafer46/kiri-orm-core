/**
 * Renders a `DiffPlan` as the source of a standalone ESM migration
 * file - the on-disk counterpart of generateMigration()'s in-memory
 * `up`/`down`, for a migration workflow that has to survive between
 * runs.
 *
 * The file is meant to be read, reviewed and, if needed, edited:
 *
 *   export const summary  - the describePlan() lines, for logs and review
 *   export async function up(db, helpers)
 *   export async function down(db, helpers)
 *   export const meta     - per touched model, the `_meta_*` snapshot
 *                           before and after (see meta/snapshot.js);
 *                           applied/rolled back with the schema change
 *
 * It is self-contained on purpose. Every field descriptor a change
 * needs is embedded, so the file keeps meaning the same thing after
 * the models it was generated from have changed again. It imports
 * nothing: the column-building helpers arrive as `up`/`down`'s second
 * argument, so the file runs wherever it is loaded from (the runner
 * in ./runner.js supplies them) without needing `@kiri-orm/core` to
 * resolve from the migrations directory.
 *
 * The safety rules are exactly generateMigration()'s, because this
 * calls it first: a plan with destructive operations throws
 * `MigrationSafetyError` unless `allowDestructive` is set, and field
 * type changes always throw.
 *
 * @param {import('./diff.js').DiffPlan} plan
 * @param {import('../models/registry.js').ModelRegistry} modelRegistry
 * @param {Object} [options]
 * @param {boolean} [options.allowDestructive]
 * @param {Record<string, { before: object|null, after: object|null }>} [options.meta]
 * @param {string} [options.header] - text for the leading comment
 * @returns {string}
 * @throws {import('./errors.js').MigrationSafetyError}
 */
export declare function renderMigrationSource(plan: import('./diff.js').DiffPlan, modelRegistry: import('../models/registry.js').ModelRegistry, options?: {
    allowDestructive?: boolean;
    meta?: Record<string, {
        before: object | null;
        after: object | null;
    }>;
    header?: string;
}): string;
