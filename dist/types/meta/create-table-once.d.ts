/**
 * Creates one of the ORM's own bookkeeping tables (`_meta_models`, `_meta_fields`,
 * `_meta_migrations`) if it doesn't exist yet.
 *
 * "Check, then create" races when two processes start on a fresh database together (two app
 * instances running `migrate:up` or `syncModels()` on their first deploy): both see no table,
 * and the slower CREATE fails with "already exists" (before 0.1.7 that failed the whole run).
 * The losing CREATE is now ignored when the table turns out to exist after all - the other
 * process made it, with the same definition.
 *
 * @param {import('knex').Knex} db
 * @param {string} name
 * @param {(table: import('knex').Knex.CreateTableBuilder) => void} define
 */
export declare function createTableOnce(db: import('knex').Knex, name: string, define: (table: import('knex').Knex.CreateTableBuilder) => void): Promise<void>;
