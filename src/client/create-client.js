import { createConnection } from "../connection.js";
import { ModelRegistry } from "../models/registry.js";
import { HookRegistry } from "../uow/hooks.js";
import { OrmClient } from "./orm-client.js";

/**
 * Builds a single `OrmClient` from a connection config plus either a
 * flat list of model descriptors (`options.models`) or a list of
 * `defineModule()` results (`options.modules`), or both. This is the
 * intended entry point for an app using this ORM - `ModelRegistry`,
 * `Repository`/`RepositoryFactory`, and `HookRegistry` are still
 * available directly for lower-level/advanced use, but a normal app
 * should only need this.
 *
 * Deliberately does NOT sync automatically - call `client.sync()`
 * once you're ready, so schema changes stay an explicit, visible step
 * (matching every other phase of this ORM, where sync() is always
 * something the caller chooses to run, never implicit).
 *
 * @param {import('../connection.js').ConnectionConfig} connectionConfig
 * @param {Object} [options]
 * @param {object[]} [options.models] - flat model descriptors
 * @param {import('./module.js').OrmModule[]} [options.modules]
 * @param {(hooks: HookRegistry) => void} [options.registerHooks] - for hooks not tied to a module
 * @param {import('../models/naming.js').NamingStrategy} [options.namingStrategy]
 * @param {import('../fields/registry.js').FieldTypeRegistry} [options.fieldTypeRegistry]
 * @returns {OrmClient}
 */
export function createClient(connectionConfig, options = {}) {
  const db = createConnection(connectionConfig);
  const registry = new ModelRegistry({
    namingStrategy: options.namingStrategy,
    fieldTypeRegistry: options.fieldTypeRegistry,
  });
  const hooks = new HookRegistry();

  for (const model of options.models ?? []) {
    registry.define(model);
  }
  for (const mod of options.modules ?? []) {
    for (const model of mod.models) {
      // Any order works: a module may extend a model another module defines, whichever comes first.
      registry.define(model, { origin: mod.name });
    }
  }
  registry.assertResolved();
  for (const mod of options.modules ?? []) {
    mod.registerHooks(hooks);
  }
  if (options.registerHooks) {
    options.registerHooks(hooks);
  }

  // Reports are registered next to models: directly, or by a module. Names are global to the client.
  const reports = [...(options.reports ?? []), ...(options.modules ?? []).flatMap((mod) => mod.reports)];
  const seen = new Set();
  for (const report of reports) {
    if (!report || typeof report.name !== "string" || typeof report.from !== "string" || !report.fields) {
      throw new TypeError("`reports` must contain values returned by defineReport()");
    }
    if (seen.has(report.name)) throw new Error(`Report "${report.name}" is registered more than once`);
    seen.add(report.name);
  }

  const moduleServices = (options.modules ?? [])
    .filter((mod) => mod.createService)
    .map((mod) => ({ name: mod.name, createService: mod.createService }));

  return new OrmClient(db, registry, hooks, undefined, moduleServices, reports);
}
