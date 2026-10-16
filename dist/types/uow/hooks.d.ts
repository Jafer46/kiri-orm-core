/**
 * The complete set of lifecycle hooks a model can register for.
 * `beforeSave`/`afterSave` fire around BOTH create and update (in
 * addition to the more specific `*Create`/`*Update` hooks), for
 * cross-cutting concerns (e.g. normalization) that don't care which
 * path a write took.
 */
export declare const HOOK_NAMES: string[];
/**
 * Holds lifecycle hooks registered per model and runs them in
 * registration order. If a hook throws (or its returned promise
 * rejects), remaining hooks for that phase are never run and the
 * error propagates straight to the caller - a `before*` hook throwing
 * means the underlying create/update/delete never happens at all,
 * since UnitOfWork always awaits the relevant `before*` hooks before
 * issuing the write.
 */
export declare class HookRegistry {
    #private;
    /**
     * @param {string} modelName
     * @param {typeof HOOK_NAMES[number]} hookName
     * @param {(...args: unknown[]) => unknown} fn
     */
    on(modelName: string, hookName: typeof HOOK_NAMES[number], fn: (...args: unknown[]) => unknown): this;
    /**
     * Runs every hook registered for `modelName`/`hookName`, in
     * registration order, awaiting each before starting the next.
     *
     * @param {string} modelName
     * @param {typeof HOOK_NAMES[number]} hookName
     * @param {unknown[]} args
     */
    run(modelName: string, hookName: typeof HOOK_NAMES[number], ...args: unknown[]): Promise<void>;
}
