/** Which dialect a Knex instance talks to, from its client name. */
export declare function dialectOf(db: any): "other" | "postgres" | "sqlite";
/**
 * The foreign keys that actually exist on a table, as `{ column, refTable }` pairs. SQLite and
 * Postgres are supported; any other dialect returns `null` ("can't tell"), which callers treat
 * as "don't second-guess the database".
 *
 * @param {import('knex').Knex} db
 * @param {string} tableName
 * @returns {Promise<Array<{ column: string, refTable: string }>|null>}
 */
export declare function listForeignKeys(db: import('knex').Knex, tableName: string): Promise<Array<{
    column: string;
    refTable: string;
}> | null>;
/**
 * SQLite only enforces foreign keys on connections that have turned `PRAGMA foreign_keys` on,
 * and it is off by default. Connections made by createConnection() turn it on themselves; for
 * one you built yourself this tries, and reports whether it ended up on.
 *
 * @returns {Promise<boolean|null>} true/false for SQLite, null for other dialects
 */
export declare function ensureSqliteForeignKeys(db: any): Promise<boolean | null>;
