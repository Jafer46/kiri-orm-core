/**
 * Diffs the models currently registered via `createModel()` against
 * what's recorded in `_meta_fields` (same as `diffSchema()` elsewhere
 * in this ORM), using the default connection/registry - the piece
 * that was missing entirely: there was no way to reach the global
 * API's internal registry to run a migration against it at all,
 * meaning removing a field from a schema had no path to actually
 * dropping the column, ever, through this API.
 *
 * @param {Object} [options]
 * @param {Record<string, string>} [options.modelRenames]
 * @param {Record<string, Record<string, string>>} [options.fieldRenames]
 * @returns {Promise<import('../migrations/diff.js').DiffPlan>}
 */
export declare function diffModels(options?: {
    modelRenames?: Record<string, string>;
    fieldRenames?: Record<string, Record<string, string>>;
}): Promise<import('../migrations/diff.js').DiffPlan>;
/**
 * Diffs, then generates and applies a migration for every change
 * between the currently-registered models and what's actually in the
 * database - the one-call path for "I removed/renamed/added a field,
 * make the database match."
 *
 * Same safety rule as `generateMigration()` everywhere else in this
 * ORM: destructive changes (a dropped model or field) are refused
 * unless `{ allowDestructive: true }` is passed explicitly. Field
 * type changes are always refused, with no override - resolve those
 * by hand (see `generateMigration()`'s docs for why).
 *
 * After applying, this also re-syncs (Phase 3/4's `sync()`) so
 * `_meta_fields` reflects the new reality - a later call to
 * `migrateModels()`/`diffModels()` will correctly report no changes
 * rather than re-diffing against stale metadata.
 *
 * Pass `{ dryRun: true }` to get the plan and its human-readable
 * `describePlan()` summary back WITHOUT applying anything - useful to
 * review what would happen first.
 *
 * @param {Object} [options]
 * @param {boolean} [options.allowDestructive]
 * @param {boolean} [options.dryRun]
 * @param {Record<string, string>} [options.modelRenames]
 * @param {Record<string, Record<string, string>>} [options.fieldRenames]
 * @returns {Promise<{ plan: import('../migrations/diff.js').DiffPlan, summary: string[], applied: boolean }>}
 */
export declare function migrateModels(options?: {
    allowDestructive?: boolean;
    dryRun?: boolean;
    modelRenames?: Record<string, string>;
    fieldRenames?: Record<string, Record<string, string>>;
}): Promise<{
    plan: import('../migrations/diff.js').DiffPlan;
    summary: string[];
    applied: boolean;
}>;
/**
 * Escape hatch for anyone who wants to call the lower-level, explicit
 * migration functions (`generateMigration`, `applyMigration`,
 * `rollbackMigration`, `describePlan` - all already available from
 * `@kiri-orm/core` directly, not re-exported again here to avoid a
 * duplicate-export collision) with more control than
 * `migrateModels()` gives - e.g. to inspect and modify a migration
 * before applying it, or to roll one back.
 *
 * @returns {import('../models/registry.js').ModelRegistry}
 */
export declare function getDefaultModelRegistry(): import('../models/registry.js').ModelRegistry;
