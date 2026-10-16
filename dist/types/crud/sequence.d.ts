/** True for a Postgres-family Knex instance. */
export declare function isPostgres(db: any): boolean;
/**
 * Keeps a Postgres `serial` primary key's sequence ahead of ids that were
 * supplied explicitly.
 *
 * Inserting `{ id: 5 }` into a serial column never touches its sequence, so
 * a later auto-assigned id walks up to 5 and fails with a duplicate key
 * (or, worse, in the SAME statement: `[{ id: 1 }, {}]` gives the second row
 * nextval() = 1). SQLite has no such problem - it picks max(rowid) + 1.
 *
 * Called BEFORE inserting a batch that contains explicit ids. It moves the
 * sequence to the largest of: its own next value, the largest explicit id in
 * the batch, and the largest id already in the table (which also repairs a
 * sequence an earlier explicit insert left behind). It never moves the
 * sequence backwards; the cost is at most one skipped number.
 *
 * A no-op for any other dialect, for uuid / non-auto keys, and when the batch
 * has no explicit key.
 *
 * @param {import('knex').Knex} db - connection or transaction
 * @param {object} model
 * @param {Record<string, unknown>[]} valuesList - validated rows about to be inserted
 * @returns {Promise<boolean>} whether the sequence was touched
 */
export declare function advanceSequence(db: import('knex').Knex, model: object, valuesList: Record<string, unknown>[]): Promise<boolean>;
/**
 * Repairs one model's auto-increment sequence so the next generated id is past every
 * id in the table.
 *
 * advanceSequence() covers ids written through this ORM's own inserts. Anything that
 * puts ids in behind its back - a raw `client.db` / `getConnection()` insert, a seed
 * script, a dump restore, a manual renumbering - leaves the sequence behind, and the
 * next auto-assigned id then collides. This is the remedy for those.
 *
 * Safe to run any time and any number of times. It never moves a sequence backwards
 * (so ids of deleted rows aren't reused), and costs at most one skipped number.
 * A no-op on SQLite, and for uuid / non-auto / missing keys.
 *
 * @param {import('knex').Knex} db - connection or transaction
 * @param {object} model
 * @returns {Promise<boolean>} whether a sequence was found and moved
 */
export declare function syncSequence(db: import('knex').Knex, model: object): Promise<boolean>;
/**
 * syncSequence() for every model in a registry. (Named apart from the global API's `syncSequences()`, which wraps it: both are re-exported from the package root.)
 *
 * @param {import('knex').Knex} db - connection or transaction
 * @param {import('../models/registry.js').ModelRegistry} registry
 * @returns {Promise<Array<{ model: string, table: string, synced: boolean }>>} one entry per model
 */
export declare function syncRegistrySequences(db: import('knex').Knex, registry: import('../models/registry.js').ModelRegistry): Promise<Array<{
    model: string;
    table: string;
    synced: boolean;
}>>;
