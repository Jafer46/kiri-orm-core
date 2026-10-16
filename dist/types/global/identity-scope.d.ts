/**
 * Runs `fn` with a fresh identity map. Returns whatever `fn` returns;
 * a throw propagates. Nesting starts a new, independent map for the
 * inner call (like a nested `withUnitOfWork`), rather than joining the
 * outer one.
 *
 * @template T
 * @param {() => Promise<T>|T} fn
 * @returns {Promise<T>|T}
 */
export declare function withIdentityMap<T>(fn: () => Promise<T> | T): Promise<T> | T;
/**
 * The map for the current async context, or undefined when not inside
 * `withIdentityMap()`. Keys are `${modelName}:${id}`.
 *
 * @returns {Map<string, object>|undefined}
 */
export declare function currentIdentityMap(): Map<string, object> | undefined;
