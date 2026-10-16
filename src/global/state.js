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
export const state = {
  connection: null,
  registry: new ModelRegistry(),
  hooks: new HookRegistry(),
  // modelName -> (record) => document. Filled in by createModel() so a
  // create that also creates related records (Command.create) can hand
  // back / hook those as documents of the right model.
  wrappers: new Map(),
  // modelName -> the Model object createModel()/extendModel() return.
  // One per name, shared: extendModel("x") before or after createModel("x")
  // must hand back the SAME object, not a second, disconnected one.
  models: new Map(),
  // mixinName -> hooks object ({ beforeCreate: fn|fn[], ... }), accumulated
  // across defineMixin() and extendModel() calls on that mixin. Read by
  // createModel() when a model declares `mixins: [...]` - see the docstring
  // on defineMixin() for why this is a read-once-at-creation-time pull
  // rather than something later mixin hook additions reach backwards for.
  mixinHooks: new Map(),
  // reportName -> ReportHandle, filled by createReport().
  reports: new Map(),
};

/**
 * Resets all global state. Not part of the normal API surface - for
 * tests only, so multiple test files (or multiple describe blocks
 * within one file) can each start from a clean slate rather than
 * colliding on model names registered by an earlier test.
 */
export function __resetGlobalStateForTests() {
  state.connection = null;
  state.registry = new ModelRegistry();
  state.hooks = new HookRegistry();
  state.wrappers = new Map();
  state.models = new Map();
  state.mixinHooks = new Map();
  state.reports = new Map();
}
