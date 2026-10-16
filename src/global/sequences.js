import { syncRegistrySequences } from "../crud/sequence.js";
import { getConnection } from "./connect.js";
import { state } from "./state.js";

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
export async function syncSequences(options = {}) {
  return syncRegistrySequences(options.trx ?? getConnection(), state.registry);
}
