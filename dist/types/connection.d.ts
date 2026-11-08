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
    /**
     * - postgres only: passed to the `pg` driver (`true`, or
     * `{ rejectUnauthorized, ca, ... }`). Since 0.1.7.
     */
    ssl?: boolean | object;
    /**
     * - Knex pool settings (Postgres default: min 2, max 10; SQLite: 1 connection). An `afterCreate`
     * of your own runs after the ORM's (SQLite turns foreign keys on there). Since 0.1.7.
     */
    pool?: {
        min?: number;
        max?: number;
        idleTimeoutMillis?: number;
        afterCreate?: Function;
    };
    /**
     * - ms to wait for a free pooled connection before
     * failing (Knex default 60000). Since 0.1.7.
     */
    acquireConnectionTimeout?: number;
};
/**
 * @typedef {Object} ConnectionConfig
 * @property {"sqlite"|"postgres"} dialect
 * @property {string} [filename]            - sqlite only, e.g. ":memory:" or a file path
 * @property {string} [connectionString]    - postgres only
 * @property {boolean|object} [ssl]         - postgres only: passed to the `pg` driver (`true`, or
 *   `{ rejectUnauthorized, ca, ... }`). Since 0.1.7.
 * @property {{ min?: number, max?: number, idleTimeoutMillis?: number, afterCreate?: Function }} [pool]
 *   - Knex pool settings (Postgres default: min 2, max 10; SQLite: 1 connection). An `afterCreate`
 *   of your own runs after the ORM's (SQLite turns foreign keys on there). Since 0.1.7.
 * @property {number} [acquireConnectionTimeout] - ms to wait for a free pooled connection before
 *   failing (Knex default 60000). Since 0.1.7.
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
