/**
 * Supported dialects for Phase 0. More can be added later without
 * touching call sites, since everything routes through this factory.
 */
declare const DIALECTS: readonly ["sqlite", "postgres"];
export type ConnectionConfig = {
    dialect: "sqlite" | "postgres";
    /**
     * - sqlite only, e.g. ":memory:" or a file path
     */
    filename?: string;
    /**
     * - postgres only
     */
    connectionString?: string;
};
/**
 * @typedef {Object} ConnectionConfig
 * @property {"sqlite"|"postgres"} dialect
 * @property {string} [filename]            - sqlite only, e.g. ":memory:" or a file path
 * @property {string} [connectionString]    - postgres only
 */
/**
 * Creates a Knex instance for the given dialect. This is the single
 * chokepoint all DB access should go through, so dialect quirks stay
 * isolated here instead of leaking into model/query code.
 *
 * @param {ConnectionConfig} config
 * @returns {import('knex').Knex}
 */
export declare function createConnection(config: ConnectionConfig): import('knex').Knex;
/**
 * Gracefully closes a Knex connection. Wrapped so call sites (and tests)
 * don't need to know about `.destroy()` vs other cleanup APIs if that
 * ever changes per-dialect.
 *
 * @param {import('knex').Knex} db
 */
export declare function closeConnection(db: import('knex').Knex): Promise<void>;
export { DIALECTS };
