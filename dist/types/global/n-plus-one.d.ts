/**
 * Runs `fn` while watching the global connection, and returns what repeated: `{ result, findings }`.
 * Each finding is `{ shape, sql, statement, count }` for a statement that ran `threshold`
 * (default 5) or more times. Never throws for findings - see assertNoNPlusOne() for that.
 *
 * ```js
 * const { findings } = await detectNPlusOne(async () => {
 *   for (const post of await Post.find()) await Post.load(post, "author");   // one query per post
 * });
 * ```
 *
 * A heuristic for development and tests: a legitimate loop repeats a statement too. Options:
 * `threshold`, `windowMs`, `statements` (default `["select"]`).
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {object} [options]
 * @returns {Promise<{ result: T, findings: import('../diagnostics/n-plus-one.js').Finding[] }>}
 */
export declare function detectNPlusOne<T>(fn: () => Promise<T>, options?: object): Promise<{
    result: T;
    findings: import('../diagnostics/n-plus-one.js').Finding[];
}>;
/**
 * Like detectNPlusOne(), but throws an NPlusOneError (with `.findings`) if anything repeated, and
 * otherwise returns what `fn` returned. For tests that guard a code path against regressing into N+1.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {object} [options]
 * @returns {Promise<T>}
 */
export declare function assertNoNPlusOne<T>(fn: () => Promise<T>, options?: object): Promise<T>;
/**
 * A live watcher for development: warns on the console, once per statement, as soon as one repeats
 * `threshold` times within `windowMs` (default 250ms). Returns the monitor; call `.detach()` to stop.
 * Pass `onDetect(finding)` to do something other than console.warn.
 *
 * @param {object} [options]
 * @returns {import('../diagnostics/n-plus-one.js').QueryMonitor}
 */
export declare function watchNPlusOne(options?: object): import('../diagnostics/n-plus-one.js').QueryMonitor;
