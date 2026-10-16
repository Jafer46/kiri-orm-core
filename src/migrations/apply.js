/**
 * Runs a migration's `up`. Thin pass-through kept mainly so
 * applying/rolling back reads symmetrically and is discoverable from
 * `@kiri-orm/core`'s exports.
 *
 * @param {import('knex').Knex} db
 * @param {import('./generate.js').Migration} migration
 */
export async function applyMigration(db, migration) {
  await migration.up(db);
}

/**
 * Runs a migration's `down`. See generateMigration() for exactly what
 * "reversible" does and doesn't mean here (schema-level, not
 * data-level, for destructive operations).
 *
 * @param {import('knex').Knex} db
 * @param {import('./generate.js').Migration} migration
 */
export async function rollbackMigration(db, migration) {
  await migration.down(db);
}
