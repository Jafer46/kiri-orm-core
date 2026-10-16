import { closeConnection } from "../connection.js";
import { sync } from "../schema/sync.js";
import { syncRegistrySequences } from "../crud/sequence.js";
import { UnitOfWork } from "../uow/unit-of-work.js";
import { ModelHandle } from "./model-handle.js";
import { ReportHandle } from "../reports/report-handle.js";
import { NPlusOneError, scanForNPlusOne, watchForNPlusOne } from "../diagnostics/n-plus-one.js";

const RESERVED_CLIENT_PROPERTIES = new Set([
  "db",
  "modelRegistry",
  "hooks",
  "unitOfWork",
  "models",
  "reports",
  "reportDescriptors",
  "moduleServices",
  "detectNPlusOne",
  "assertNoNPlusOne",
  "watchNPlusOne",
  "sync",
  "syncSequences",
  "transaction",
  "close",
]);

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
export class OrmClient {
  /**
   * @param {import('knex').Knex} db
   * @param {import('../models/registry.js').ModelRegistry} modelRegistry
   * @param {import('../uow/hooks.js').HookRegistry} hooks
   * @param {import('knex').Knex.Transaction} [trx]
   * @param {{ name: string, createService: (client: OrmClient) => Record<string, Function> }[]} [moduleServices]
   */
  constructor(db, modelRegistry, hooks, trx = undefined, moduleServices = [], reports = []) {
    this.db = db;
    this.modelRegistry = modelRegistry;
    this.hooks = hooks;
    this.unitOfWork = new UnitOfWork(db, modelRegistry, { hooks, trx });
    this.models = this.#buildModelsProxy();
    this.reportDescriptors = reports;
    this.reports = this.#buildReportsProxy(reports);
    this.moduleServices = moduleServices;

    for (const { name, createService } of moduleServices) {
      if (RESERVED_CLIENT_PROPERTIES.has(name)) {
        throw new TypeError(
          `Module "${name}" collides with a built-in client property of the same name. Rename the module.`
        );
      }
      this[name] = createService(this);
    }
  }

  #buildModelsProxy() {
    const unitOfWork = this.unitOfWork;
    const modelRegistry = this.modelRegistry;
    const cache = new Map();
    return new Proxy(
      {},
      {
        get(_target, modelName) {
          if (typeof modelName !== "string") return undefined;
          if (!modelRegistry.hasModel(modelName)) {
            // Fails immediately at the access point (client.models.typo),
            // not on the first method call - a clearer signal for a
            // typo'd model name than a deferred, less obvious error.
            modelRegistry.getModel(modelName); // throws UnknownModelError with the full list of valid names
          }
          if (!cache.has(modelName)) {
            cache.set(modelName, new ModelHandle(unitOfWork, modelName));
          }
          return cache.get(modelName);
        },
      }
    );
  }

  /**
   * Creates tables, meta-tables, and belongsToMany pivot tables for
   * every registered model (Phases 3/4/7's sync(), run once here).
   */
  #buildReportsProxy(descriptors) {
    const unitOfWork = this.unitOfWork;
    const byName = new Map(descriptors.map((descriptor) => [descriptor.name, descriptor]));
    const cache = new Map();
    return new Proxy(
      {},
      {
        get: (_target, reportName) => {
          if (typeof reportName !== "string") return undefined;
          if (!byName.has(reportName)) {
            throw new Error(`Unknown report "${reportName}". Registered reports: ${[...byName.keys()].join(", ") || "(none)"}`);
          }
          if (!cache.has(reportName)) {
            cache.set(
              reportName,
              new ReportHandle(byName.get(reportName), {
                db: () => unitOfWork.trx ?? this.db, // inside client.transaction() this is the transaction
                registry: () => this.modelRegistry,
                fieldTypeRegistry: unitOfWork.fieldTypeRegistry,
              })
            );
          }
          return cache.get(reportName);
        },
        has: (_target, reportName) => byName.has(reportName),
        ownKeys: () => [...byName.keys()],
        getOwnPropertyDescriptor: (_target, reportName) =>
          byName.has(reportName) ? { enumerable: true, configurable: true } : undefined,
      }
    );
  }

  /**
   * Runs `fn` while watching this client's connection (its transaction, on a `tx` client) and returns
   * what repeated: `{ result, findings }`. See `detectNPlusOne()` in global/n-plus-one.js.
   *
   * @template T
   * @param {() => Promise<T>} fn
   * @param {object} [options] - `threshold`, `windowMs`, `statements`
   */
  async detectNPlusOne(fn, options = {}) {
    return scanForNPlusOne(this.unitOfWork.trx ?? this.db, fn, options);
  }

  /** Like detectNPlusOne(), but throws an NPlusOneError (with `.findings`) if anything repeated. */
  async assertNoNPlusOne(fn, options = {}) {
    const { result, findings } = await this.detectNPlusOne(fn, options);
    if (findings.length > 0) throw new NPlusOneError(findings);
    return result;
  }

  /** A live console watcher for development; returns the monitor (`.detach()` to stop). */
  watchNPlusOne(options = {}) {
    return watchForNPlusOne(this.unitOfWork.trx ?? this.db, options);
  }

  async sync() {
    return sync(this.db, this.modelRegistry);
  }

  /**
   * Repairs every auto-increment model's sequence (Postgres) so the next
   * generated id is past every id already stored. Idempotent; never moves a
   * sequence backwards. See `syncSequence()` in crud/sequence.js.
   *
   * @returns {Promise<Array<{ model: string, table: string, synced: boolean }>>}
   */
  async syncSequences() {
    return syncRegistrySequences(this.unitOfWork.trx ?? this.db, this.modelRegistry);
  }

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
  async transaction(fn) {
    return this.db.transaction(async (trx) => {
      const txClient = new OrmClient(this.db, this.modelRegistry, this.hooks, trx, this.moduleServices, this.reportDescriptors);
      return fn(txClient);
    });
  }

  async close() {
    await closeConnection(this.db);
  }
}
