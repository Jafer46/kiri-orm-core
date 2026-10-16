import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Opt-in, scoped identity map for the global (Mongoose-style) API.
 *
 * The global API has no identity map by default, and that is
 * deliberate: its state is process-wide, so a map that lived as long
 * as the process would grow without bound and hand one request a row
 * another request loaded minutes ago. A `UnitOfWork` avoids that
 * because it is short-lived. This gives the global API the same
 * property: the map exists only for the duration of one call to
 * `withIdentityMap(fn)`.
 *
 * Inside `fn` - including everything it awaits, however deep - every
 * `find`/`findOne`/`create`/`createMany` returns ONE document instance
 * per row (per model + `id`). Outside any scope nothing changes.
 *
 * Built on AsyncLocalStorage, so concurrent scopes (two requests
 * running at once) each see only their own map, with no object to
 * thread through call sites.
 */
const storage = new AsyncLocalStorage();

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
export function withIdentityMap(fn) {
  return storage.run(new Map(), fn);
}

/**
 * The map for the current async context, or undefined when not inside
 * `withIdentityMap()`. Keys are `${modelName}:${id}`.
 *
 * @returns {Map<string, object>|undefined}
 */
export function currentIdentityMap() {
  return storage.getStore();
}
