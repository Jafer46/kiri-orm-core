/**
 * Runs a migration's `up`. Thin pass-through kept mainly so
 * applying/rolling back reads symmetrically and is discoverable from
 * `@kiri-orm/core`'s exports.
 *
 * @param {import('knex').Knex} db
 * @param {import('./generate.js').Migration} migration
 */
export declare function applyMigration(db: import('knex').Knex, migration: import('./generate.js').Migration): Promise<void>;
/**
 * Runs a migration's `down`. See generateMigration() for exactly what
 * "reversible" does and doesn't mean here (schema-level, not
 * data-level, for destructive operations).
 *
 * @param {import('knex').Knex} db
 * @param {import('./generate.js').Migration} migration
 */
export declare function rollbackMigration(db: import('knex').Knex, migration: import('./generate.js').Migration): Promise<void>;
