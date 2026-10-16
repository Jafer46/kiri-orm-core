/** Which dialect a Knex instance talks to, from its client name. */
export function dialectOf(db) {
  const client = String(db.client?.config?.client ?? db.client?.dialect ?? "");
  if (/sqlite/i.test(client)) return "sqlite";
  if (/^(pg|postgres)/i.test(client) || /postgres/i.test(String(db.client?.dialect ?? ""))) return "postgres";
  return "other";
}

/**
 * The foreign keys that actually exist on a table, as `{ column, refTable }` pairs. SQLite and
 * Postgres are supported; any other dialect returns `null` ("can't tell"), which callers treat
 * as "don't second-guess the database".
 *
 * @param {import('knex').Knex} db
 * @param {string} tableName
 * @returns {Promise<Array<{ column: string, refTable: string }>|null>}
 */
export async function listForeignKeys(db, tableName) {
  const dialect = dialectOf(db);
  if (dialect === "sqlite") {
    const rows = await db.raw(`PRAGMA foreign_key_list(${JSON.stringify(tableName)})`);
    return rows.map((row) => ({ column: row.from, refTable: row.table }));
  }
  if (dialect === "postgres") {
    const { rows } = await db.raw(
      `select a.attname as "column", rt.relname as ref_table
         from pg_constraint c
         join pg_class t on t.oid = c.conrelid
         join pg_namespace n on n.oid = t.relnamespace
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
         join pg_class rt on rt.oid = c.confrelid
        where c.contype = 'f' and t.relname = ? and n.nspname = current_schema()`,
      [tableName]
    );
    return rows.map((row) => ({ column: row.column, refTable: row.ref_table }));
  }
  return null;
}

/**
 * SQLite only enforces foreign keys on connections that have turned `PRAGMA foreign_keys` on,
 * and it is off by default. Connections made by createConnection() turn it on themselves; for
 * one you built yourself this tries, and reports whether it ended up on.
 *
 * @returns {Promise<boolean|null>} true/false for SQLite, null for other dialects
 */
export async function ensureSqliteForeignKeys(db) {
  if (dialectOf(db) !== "sqlite") return null;
  const enabled = async () => Number((await db.raw("PRAGMA foreign_keys"))[0]?.foreign_keys) === 1;
  if (await enabled()) return true;
  await db.raw("PRAGMA foreign_keys = ON");
  return enabled();
}
