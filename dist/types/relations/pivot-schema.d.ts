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
export declare function ensurePivotTables(db: import('knex').Knex, modelRegistry: import('../models/registry.js').ModelRegistry): Promise<void>;
