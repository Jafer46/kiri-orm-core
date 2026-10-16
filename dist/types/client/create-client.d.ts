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
export declare function createClient(connectionConfig: import('../connection.js').ConnectionConfig, options?: {
    models?: object[];
    modules?: import('./module.js').OrmModule[];
    registerHooks?: (hooks: HookRegistry) => void;
    namingStrategy?: import('../models/naming.js').NamingStrategy;
    fieldTypeRegistry?: import('../fields/registry.js').FieldTypeRegistry;
}): OrmClient;
