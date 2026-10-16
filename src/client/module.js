/**
 * @typedef {Object} OrmModule
 * @property {string} name
 * @property {object[]} models - raw model descriptors (what you'd pass to registry.define())
 * @property {(hooks: import('../uow/hooks.js').HookRegistry) => void} registerHooks
 * @property {((client: import('./orm-client.js').OrmClient) => Record<string, Function>)|null} createService
 */

/**
 * Packages one bounded-context's models, hooks, AND domain operations
 * into a single unit a composition root can pass to
 * `createClient({ modules: [...] })`. This is what makes a modular
 * monolith actually modular in practice: each module (identity,
 * billing, catalog, ...) owns and can unit-test its own model
 * definitions, business-rule hooks, and use cases in isolation,
 * without importing anything from the other modules - the
 * composition root is the only place that needs to know every module
 * exists, and app-level code (seeding, request handlers, whatever)
 * should only ever call a module's `createService` functions, never
 * reach into `client.models.<name>` for another module's models
 * directly. `client.models.<name>` stays available for a module's OWN
 * use within its own `createService` implementation, and for direct,
 * single-module apps that don't need this structure at all.
 *
 * `createService`, if provided, is called once per `OrmClient`
 * (including once per transaction-scoped client - see
 * `OrmClient#transaction`) with that client, and should return a
 * plain object of functions implementing the module's actual
 * operations (e.g. `placeOrder`, `cancelOrder` - not just generic
 * create/find). The returned object is exposed as `client.<name>`, so
 * `client` never needs to be threaded through by hand at every call
 * site the way it would calling an exported function directly.
 *
 * @param {Object} options
 * @param {string} options.name
 * @param {object[]} options.models
 * @param {(hooks: import('../uow/hooks.js').HookRegistry) => void} [options.registerHooks]
 * @param {(client: import('./orm-client.js').OrmClient) => Record<string, Function>} [options.createService]
 * @returns {Readonly<OrmModule>}
 */
export function defineModule(options) {
  if (!options || typeof options.name !== "string" || !options.name) {
    throw new TypeError("defineModule() requires a non-empty `name`");
  }
  if (!Array.isArray(options.models) || options.models.length === 0) {
    throw new TypeError(`Module "${options.name}" requires a non-empty \`models\` array`);
  }
  if (options.createService !== undefined && typeof options.createService !== "function") {
    throw new TypeError(`Module "${options.name}" \`createService\` must be a function when provided`);
  }
  if (options.reports !== undefined && !Array.isArray(options.reports)) {
    throw new TypeError(`Module "${options.name}" \`reports\` must be an array of defineReport() results`);
  }
  return Object.freeze({
    name: options.name,
    models: options.models,
    // Reports (see defineReport) this module contributes; they appear on `client.reports`.
    reports: options.reports ?? [],
    registerHooks: options.registerHooks ?? (() => {}),
    createService: options.createService ?? null,
  });
}
