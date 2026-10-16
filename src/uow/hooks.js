import { InvalidHookNameError } from "./errors.js";

/**
 * The complete set of lifecycle hooks a model can register for.
 * `beforeSave`/`afterSave` fire around BOTH create and update (in
 * addition to the more specific `*Create`/`*Update` hooks), for
 * cross-cutting concerns (e.g. normalization) that don't care which
 * path a write took.
 */
export const HOOK_NAMES = [
  "beforeCreate",
  "afterCreate",
  "beforeUpdate",
  "afterUpdate",
  "beforeSave",
  "afterSave",
  "beforeDelete",
  "afterDelete",
];

/**
 * Holds lifecycle hooks registered per model and runs them in
 * registration order. If a hook throws (or its returned promise
 * rejects), remaining hooks for that phase are never run and the
 * error propagates straight to the caller - a `before*` hook throwing
 * means the underlying create/update/delete never happens at all,
 * since UnitOfWork always awaits the relevant `before*` hooks before
 * issuing the write.
 */
export class HookRegistry {
  #hooks = new Map(); // `${modelName}:${hookName}` -> fn[]

  /**
   * @param {string} modelName
   * @param {typeof HOOK_NAMES[number]} hookName
   * @param {(...args: unknown[]) => unknown} fn
   */
  on(modelName, hookName, fn) {
    if (!HOOK_NAMES.includes(hookName)) {
      throw new InvalidHookNameError(
        `Unknown hook "${hookName}". Valid hooks: ${HOOK_NAMES.join(", ")}`
      );
    }
    if (typeof fn !== "function") {
      throw new InvalidHookNameError(`Hook handler for "${hookName}" must be a function`);
    }
    const key = `${modelName}:${hookName}`;
    if (!this.#hooks.has(key)) this.#hooks.set(key, []);
    this.#hooks.get(key).push(fn);
    return this;
  }

  /**
   * Runs every hook registered for `modelName`/`hookName`, in
   * registration order, awaiting each before starting the next.
   *
   * @param {string} modelName
   * @param {typeof HOOK_NAMES[number]} hookName
   * @param {unknown[]} args
   */
  async run(modelName, hookName, ...args) {
    const fns = this.#hooks.get(`${modelName}:${hookName}`) ?? [];
    for (const fn of fns) {
      await fn(...args);
    }
  }
}
