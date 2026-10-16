import { UnitOfWork } from "../uow/unit-of-work.js";
/**
 * The single object an app built on this ORM actually holds onto.
 * Wraps a `db` connection, a `ModelRegistry`, and a `HookRegistry`
 * (which `createClient()` builds for you), and exposes:
 *
 * - `client.reports.<name>` - a `ReportHandle` per report registered with `createClient({ reports })`
 *   or a module's `reports`: read-only summary rows (see `defineReport()`), one SQL statement per call,
 *   following the client into transactions like `client.models` does.
 * - `client.models.<name>` - a `ModelHandle` per registered model,
 *   built lazily and cached, validated eagerly (accessing an unknown
 *   model name throws immediately, not on the first method call).
 *   Generic CRUD - the right level for a module's OWN use within its
 *   own service, or for a small single-module app that doesn't need
 *   more structure than that.
 * - `client.<moduleName>` - if a module was defined with
 *   `createService`, its result is exposed here: real domain
 *   operations (`client.orders.placeOrder(...)`), not just generic
 *   CRUD. This is the surface app-level code (seeding, request
 *   handlers) and OTHER modules should actually call - reaching into
 *   `client.models.<name>` for a model that belongs to a different
 *   module bypasses whatever validation/business rules that module's
 *   service enforces, defeating the point of having modules at all.
 * - `client.sync()` - runs Phase 3-7's sync() (tables, meta, pivots).
 * - `client.syncSequences()` - moves every auto-increment model's Postgres
 *   sequence past the ids already in its table; run it after inserting ids
 *   outside the ORM (raw SQL, seeds, a restored dump). No-op on SQLite.
 * - `client.transaction(fn)` - runs `fn` against a transaction-scoped
 *   client with its own identity map, committing/rolling back with
 *   the transaction (built on `UnitOfWork` under the hood). Module
 *   services are rebuilt for the transaction-scoped client too, so
 *   `tx.orders.placeOrder(...)` works identically inside a
 *   transaction as outside one.
 * - `client.db` - the raw Knex instance, an intentional escape hatch
 *   for anything not yet covered by the higher-level surface.
 * - `client.close()` - closes the connection.
 */
export declare class OrmClient {
    #private;
    db: import("knex").Knex<any, any[]>;
    modelRegistry: import("../models/registry.js").ModelRegistry;
    hooks: import("../uow/hooks.js").HookRegistry;
    unitOfWork: UnitOfWork;
    models: {};
    reportDescriptors: any[];
    reports: {};
    moduleServices: {
        name: string;
        createService: (client: OrmClient) => Record<string, Function>;
    }[];
    /**
     * @param {import('knex').Knex} db
     * @param {import('../models/registry.js').ModelRegistry} modelRegistry
     * @param {import('../uow/hooks.js').HookRegistry} hooks
     * @param {import('knex').Knex.Transaction} [trx]
     * @param {{ name: string, createService: (client: OrmClient) => Record<string, Function> }[]} [moduleServices]
     */
    constructor(db: import('knex').Knex, modelRegistry: import('../models/registry.js').ModelRegistry, hooks: import('../uow/hooks.js').HookRegistry, trx?: import('knex').Knex.Transaction, moduleServices?: {
        name: string;
        createService: (client: OrmClient) => Record<string, Function>;
    }[], reports?: any[]);
    /**
     * Runs `fn` while watching this client's connection (its transaction, on a `tx` client) and returns
     * what repeated: `{ result, findings }`. See `detectNPlusOne()` in global/n-plus-one.js.
     *
     * @template T
     * @param {() => Promise<T>} fn
     * @param {object} [options] - `threshold`, `windowMs`, `statements`
     */
    detectNPlusOne<T>(fn: () => Promise<T>, options?: object): Promise<{
        result: T;
        findings: import("../diagnostics/n-plus-one.js").Finding[];
    }>;
    /** Like detectNPlusOne(), but throws an NPlusOneError (with `.findings`) if anything repeated. */
    assertNoNPlusOne(fn: any, options?: {}): Promise<any>;
    /** A live console watcher for development; returns the monitor (`.detach()` to stop). */
    watchNPlusOne(options?: {}): import("../diagnostics/n-plus-one.js").QueryMonitor;
    sync(): Promise<import("../schema/sync.js").SyncResult>;
    /**
     * Repairs every auto-increment model's sequence (Postgres) so the next
     * generated id is past every id already stored. Idempotent; never moves a
     * sequence backwards. See `syncSequence()` in crud/sequence.js.
     *
     * @returns {Promise<Array<{ model: string, table: string, synced: boolean }>>}
     */
    syncSequences(): Promise<Array<{
        model: string;
        table: string;
        synced: boolean;
    }>>;
    /**
     * Runs `fn` with a transaction-scoped client: same models/hooks/
     * module services, but its own identity map, and every operation
     * inside runs as part of one Knex transaction. Commits on success,
     * rolls back if `fn` throws - same semantics as `withUnitOfWork`,
     * exposed through the same `client.models.<name>` /
     * `client.<moduleName>` surface instead of `uow.find(name, ...)`
     * calls, so code doesn't change shape between transactional and
     * non-transactional use.
     *
     * @template T
     * @param {(txClient: OrmClient) => Promise<T>} fn
     * @returns {Promise<T>}
     */
    transaction<T>(fn: (txClient: OrmClient) => Promise<T>): Promise<T>;
    close(): Promise<void>;
}
