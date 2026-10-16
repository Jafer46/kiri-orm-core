export type Migration = {
    up: (db: import('knex').Knex) => Promise<void>;
    down: (db: import('knex').Knex) => Promise<void>;
    /**
     * - describePlan() output, for logging/review
     */
    summary: string[];
};
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
export declare function generateMigration(plan: import('./diff.js').DiffPlan, modelRegistry: import('../models/registry.js').ModelRegistry, options?: {
    allowDestructive?: boolean;
    columnBuilderRegistry?: import('../schema/column-builder-registry.js').ColumnBuilderRegistry;
}): Migration;
