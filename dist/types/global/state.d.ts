import { ModelRegistry } from "../models/registry.js";
import { HookRegistry } from "../uow/hooks.js";
/**
 * The state backing the Mongoose-style global API (`connect()`,
 * `createModel()`, `syncModels()`). Exactly one of each, module-level,
 * shared by every file that imports from this package - the same
 * mechanism that makes `import { User } from './models/user.js'`
 * usable from anywhere without threading a `client`/`db`/`registry`
 * through every call site: every `createModel()` call, in any file,
 * registers into THIS registry and reads from THIS connection,
 * because it's the same module instance across the whole app (Node's
 * module cache gives every importer the same object).
 *
 * This is genuinely global, mutable state - the trade-off Mongoose
 * itself makes (`mongoose.connect()` sets its one default connection
 * the same way). It means exactly one connection/schema-set per Node
 * process using this API. Apps that need more than one distinct
 * connection or a fully isolated per-request scope should use
 * `createClient()`/`UnitOfWork` instead (see the client module),
 * which take an explicit `ModelRegistry`/connection rather than
 * sharing one implicitly.
 */
export declare const state: {
    connection: null;
    registry: ModelRegistry;
    hooks: HookRegistry;
    wrappers: Map<any, any>;
    models: Map<any, any>;
    mixinHooks: Map<any, any>;
    reports: Map<any, any>;
};
/**
 * Resets all global state. Not part of the normal API surface - for
 * tests only, so multiple test files (or multiple describe blocks
 * within one file) can each start from a clean slate rather than
 * colliding on model names registered by an earlier test.
 */
export declare function __resetGlobalStateForTests(): void;
