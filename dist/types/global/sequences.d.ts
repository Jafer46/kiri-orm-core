/**
 * Moves every auto-increment model's Postgres sequence past the ids already in its
 * table. Run it after anything that inserts ids outside this ORM - a raw insert, a seed
 * script, a restored dump - so the next auto-assigned id doesn't collide.
 *
 * Idempotent and never moves a sequence backwards. On SQLite it does nothing (a
 * rowid alias continues from the highest id by itself). Pass `{ trx }` to run it inside
 * a transaction.
 *
 * @param {{ trx?: import('knex').Knex.Transaction }} [options]
 * @returns {Promise<Array<{ model: string, table: string, synced: boolean }>>}
 */
export declare function syncSequences(options?: {
    trx?: import('knex').Knex.Transaction;
}): Promise<Array<{
    model: string;
    table: string;
    synced: boolean;
}>>;
