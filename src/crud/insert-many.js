import { fromRow, toRow } from "./row-mapping.js";
import { primaryKeyOf } from "../models/primary-key.js";
import { advanceSequence } from "./sequence.js";

/**
 * Per-statement limits, by dialect family.
 *
 * - SQLite: Knex compiles a multi-row INSERT to a compound
 *   `SELECT ... UNION ALL SELECT ...`, and SQLite refuses more than
 *   500 terms in one ("too many terms in compound SELECT" - verified
 *   against the bundled SQLite, 500 rows works, 501 fails). Bind
 *   variables are capped at 32766 on any SQLite >= 3.32.
 * - Postgres: 65535 bind parameters per statement, no row cap of its
 *   own. 1000 rows keeps individual statements a sane size.
 * - Anything else: conservative numbers that are safe everywhere.
 */
const LIMITS = {
  sqlite: { maxRows: 500, maxParams: 32766 },
  postgres: { maxRows: 1000, maxParams: 65535 },
  generic: { maxRows: 500, maxParams: 999 },
};

/**
 * @param {import('knex').Knex} db - a Knex instance or transaction
 * @returns {{ maxRows: number, maxParams: number }}
 */
export function insertLimitsFor(db) {
  const client = String(db?.client?.config?.client ?? "").toLowerCase();
  if (client.includes("sqlite")) return LIMITS.sqlite;
  if (
    client === "pg" ||
    client.includes("postgres") ||
    client.includes("cockroach")
  )
    return LIMITS.postgres;
  return LIMITS.generic;
}

/**
 * How many rows of `columnCount` columns fit in one INSERT on this
 * connection. `requested` can only lower the answer, never raise it
 * above what the dialect can actually execute.
 *
 * @param {import('knex').Knex} db
 * @param {number} columnCount
 * @param {number} [requested]
 * @returns {number}
 */
export function rowsPerStatement(db, columnCount, requested) {
  const { maxRows, maxParams } = insertLimitsFor(db);
  const byParams = Math.max(
    1,
    Math.floor(maxParams / Math.max(1, columnCount)),
  );
  const limit = Math.min(maxRows, byParams);
  if (requested === undefined) return limit;
  return Math.max(1, Math.min(Math.floor(requested), limit));
}

/**
 * @template T
 * @param {T[]} items
 * @param {number} size
 * @returns {T[][]}
 */
export function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size)
    chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * Pairs each INSERT ... RETURNING row back up with the input row that
 * produced it.
 *
 * Both Postgres and SQLite return rows in insertion order in
 * practice, and that is the fast path here. But nothing in either
 * SQL standard guarantees it, and getting it wrong is not a cosmetic
 * bug: a hasMany child or pivot row would be attached to the wrong
 * parent, silently. So the fast path is *verified* against each row's
 * `id` (the primary-key convention used throughout this ORM), and if
 * any pair disagrees, rows are matched by `id` instead. A model with
 * no `id` field has nothing to verify against and stays positional.
 *
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {Record<string, unknown>[]} valuesList - validated field values, in input order
 * @param {Record<string, unknown>[]} records - returned records, in whatever order the DB used
 * @returns {Record<string, unknown>[]} records in input order
 */
export function alignToInput(model, valuesList, records) {
  if (records.length !== valuesList.length) {
    throw new Error(
      `Bulk insert into "${model.tableName}" returned ${records.length} rows for ${valuesList.length} inserted - ` +
        `cannot safely match results to inputs.`,
    );
  }
  const key = primaryKeyOf(model);
  if (key === null) return records;

  let aligned = true;
  for (let i = 0; i < records.length; i++) {
    const expected = valuesList[i][key];
    if (
      expected !== null &&
      expected !== undefined &&
      records[i][key] !== expected
    ) {
      aligned = false;
      break;
    }
  }
  if (aligned) return records;

  // Slow path: match by id. A queue per id keeps duplicate ids (the
  // schema doesn't forbid them) paired off one-to-one in order.
  const byId = new Map();
  for (const record of records) {
    const k = String(record[key]);
    if (!byId.has(k)) byId.set(k, []);
    byId.get(k).push(record);
  }
  return valuesList.map((values) => {
    const match = byId.get(String(values[key]))?.shift();
    if (!match) {
      throw new Error(
        `Bulk insert into "${model.tableName}": no returned row matches input id ${JSON.stringify(values[key])}`,
      );
    }
    return match;
  });
}

/**
 * JSON columns need their value serialized explicitly on a bulk insert.
 *
 * Knex serializes an object bound to a single-row INSERT, but not one
 * inside the `SELECT ... UNION ALL SELECT ...` it compiles multi-row
 * SQLite inserts to - better-sqlite3 then rejects the raw object
 * ("can only bind numbers, strings, bigints, buffers, and null"). On
 * Postgres, `pg` sends a JS *array* as a Postgres array literal rather
 * than JSON, which a json column refuses. Passing the JSON text
 * ourselves is correct on both, and reads back through fromRow()
 * unchanged (it parses SQLite's text and Postgres hands back objects).
 *
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {Record<string, unknown>} values
 */
function serializeJsonFields(model, values) {
  let serialized = null;
  for (const [fieldName, field] of Object.entries(model.fields)) {
    if (field.type !== "json") continue;
    const value = values[fieldName];
    if (value === null || value === undefined) continue;
    serialized ??= { ...values };
    serialized[fieldName] = JSON.stringify(value);
  }
  return serialized ?? values;
}

/**
 * Inserts many already-validated rows with as few statements as the
 * dialect allows - one INSERT ... RETURNING per chunk - and returns
 * the stored records, cast back into field values, in input order.
 *
 * This does NOT open a transaction: with more than one chunk the
 * caller is responsible for atomicity (see createRecords()).
 *
 * @param {import('knex').Knex} db - connection or transaction
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {Record<string, unknown>[]} valuesList - output of prepareWrite(...).values, one per row
 * @param {import('../fields/registry.js').FieldTypeRegistry} fieldTypeRegistry
 * @param {{ chunkSize?: number }} [options]
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function insertRecords(
  db,
  model,
  valuesList,
  fieldTypeRegistry,
  options = {},
) {
  if (valuesList.length === 0) return [];

  await advanceSequence(db, model, valuesList);

  const columnCount = Object.keys(model.fields).length;
  const size = rowsPerStatement(db, columnCount, options.chunkSize);
  const results = [];

  for (const chunk of chunkArray(valuesList, size)) {
    const rows = chunk.map((values) =>
      toRow(model, serializeJsonFields(model, values)),
    );
    const returned = await db(model.tableName).insert(rows).returning("*");
    const records = returned.map((row) =>
      fromRow(model, row, fieldTypeRegistry),
    );
    results.push(...alignToInput(model, chunk, records));
  }
  return results;
}
