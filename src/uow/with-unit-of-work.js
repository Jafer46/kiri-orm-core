import { UnitOfWork } from "./unit-of-work.js";

/**
 * Runs `fn` with a `UnitOfWork` bound to a fresh Knex transaction -
 * every load/save/delete performed through it is part of that one
 * transaction, and if `fn` throws, the transaction rolls back
 * (Knex's own behavior, same as `runInTransaction` in the crud
 * module). The identity map's scope is exactly this call: a fresh
 * `UnitOfWork` (and thus a fresh, empty identity map) is created for
 * every invocation.
 *
 * @template T
 * @param {import('knex').Knex} db
 * @param {import('../models/registry.js').ModelRegistry} modelRegistry
 * @param {(uow: UnitOfWork) => Promise<T>} fn
 * @param {Object} [options]
 * @param {import('../fields/registry.js').FieldTypeRegistry} [options.fieldTypeRegistry]
 * @param {import('./hooks.js').HookRegistry} [options.hooks]
 * @returns {Promise<T>}
 */
export async function withUnitOfWork(db, modelRegistry, fn, options = {}) {
  return db.transaction(async (trx) => {
    const uow = new UnitOfWork(db, modelRegistry, { ...options, trx });
    return fn(uow);
  });
}
