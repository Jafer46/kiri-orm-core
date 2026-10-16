import { primaryKeyOf } from "../models/primary-key.js";

/** True for a Postgres-family Knex instance. */
export function isPostgres(db) {
  const client = String(db?.client?.config?.client ?? "").toLowerCase();
  return client === "pg" || client.includes("postgres") || client.includes("cockroach");
}

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
export async function advanceSequence(db, model, valuesList) {
  const key = primaryKeyOf(model);
  if (key === null || model.fields[key].autoId !== "increment" || !isPostgres(db)) return false;

  let highest = null;
  for (const values of valuesList) {
    const value = values[key];
    if (value === undefined || value === null) continue;
    const number = Number(value);
    if (Number.isFinite(number) && (highest === null || number > highest)) highest = number;
  }
  if (highest === null) return false;

  return bumpSequence(db, model, key, Math.max(highest, 1));
}

/**
 * The one statement that moves a serial sequence: to the largest of its own next value,
 * `atLeast`, and the largest id already in the table. Never backwards.
 */
async function bumpSequence(db, model, key, atLeast) {
  const column = model.columns[key];
  // Bindings are positional in the order they appear in the string below:
  // (1) the minimum to reach, (2) the MAX() column, (3) the MAX() table,
  // (4)-(5) the table/column names pg_get_serial_sequence looks the sequence up by
  // (plain identifier text, NOT pre-quoted - it does its own identifier parsing).
  await db.raw(
    `SELECT setval(s.seq::regclass, GREATEST(nextval(s.seq::regclass), ?::bigint, (SELECT COALESCE(MAX(??), 0) FROM ??))) ` +
      `FROM (SELECT pg_get_serial_sequence(?, ?) AS seq) AS s WHERE s.seq IS NOT NULL`,
    [atLeast, column, model.tableName, model.tableName, column]
  );
  return true;
}

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
export async function syncSequence(db, model) {
  const key = primaryKeyOf(model);
  if (key === null || model.fields[key].autoId !== "increment" || !isPostgres(db)) return false;
  return bumpSequence(db, model, key, 1);
}

/**
 * syncSequence() for every model in a registry. (Named apart from the global API's `syncSequences()`, which wraps it: both are re-exported from the package root.)
 *
 * @param {import('knex').Knex} db - connection or transaction
 * @param {import('../models/registry.js').ModelRegistry} registry
 * @returns {Promise<Array<{ model: string, table: string, synced: boolean }>>} one entry per model
 */
export async function syncRegistrySequences(db, registry) {
  const results = [];
  for (const name of registry.listModels()) {
    const model = registry.getModel(name);
    results.push({ model: name, table: model.tableName, synced: await syncSequence(db, model) });
  }
  return results;
}
