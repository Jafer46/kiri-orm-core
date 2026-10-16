import { HookRegistry } from "./hooks.js";
/**
 * Ties together identity-mapped loading, dirty-tracked saving, and
 * lifecycle hooks for one logical unit of work - a single request, a
 * single transaction, or any other scope the caller chooses by
 * however long they keep the instance alive. There's no implicit
 * global scope: creating a `new UnitOfWork(...)` per request (or per
 * transaction, via `withUnitOfWork()`) IS what scopes its identity
 * map, deliberately - baking in a framework-specific request
 * lifecycle here would overreach what a core ORM library should own.
 *
 * `find`/`findOne` return tracked entities (see entity.js) rather
 * than the plain objects `Repository` returns directly - loading the
 * same row twice within one `UnitOfWork` returns the exact same
 * object reference both times (the identity map), and each entity
 * gets a `.save()` that only sends the fields that actually changed
 * since it was loaded (dirty tracking, see diffEntity()).
 */
export declare class UnitOfWork {
    #private;
    db: import("knex").Knex<any, any[]>;
    modelRegistry: import("../models/registry.js").ModelRegistry;
    fieldTypeRegistry: import("../fields/registry.js").FieldTypeRegistry;
    hooks: HookRegistry;
    trx: import("knex").Knex.Transaction<any, any[]> | undefined;
    identityMap: Map<any, any>;
    /**
     * @param {import('knex').Knex} db
     * @param {import('../models/registry.js').ModelRegistry} modelRegistry
     * @param {Object} [options]
     * @param {import('../fields/registry.js').FieldTypeRegistry} [options.fieldTypeRegistry]
     * @param {HookRegistry} [options.hooks]
     * @param {import('knex').Knex.Transaction} [options.trx]
     */
    constructor(db: import('knex').Knex, modelRegistry: import('../models/registry.js').ModelRegistry, options?: {
        fieldTypeRegistry?: import('../fields/registry.js').FieldTypeRegistry;
        hooks?: HookRegistry;
        trx?: import('knex').Knex.Transaction;
    });
    /**
     * @param {string} modelName
     * @param {Record<string, unknown>|unknown[]} [filter]
     * @param {{ limit?: number, with?: string[] }} [options]
     * @returns {Promise<Record<string, unknown>[]>}
     */
    find(modelName: string, filter?: Record<string, unknown> | unknown[], options?: {
        limit?: number;
        with?: string[];
    }): Promise<Record<string, unknown>[]>;
    /**
     * @param {string} modelName
     * @param {Record<string, unknown>|unknown[]} [filter]
     * @param {{ with?: string[] }} [options]
     * @returns {Promise<Record<string, unknown>|null>}
     */
    findOne(modelName: string, filter?: Record<string, unknown> | unknown[], options?: {
        with?: string[];
    }): Promise<Record<string, unknown> | null>;
    /**
     * Creates a record and returns it as a tracked entity. Runs
     * `beforeCreate`/`beforeSave` (which may mutate `data` before the
     * insert happens) then `afterCreate`/`afterSave` (with the final
     * entity) around the write.
     *
     * `data` may include `hasMany` / `belongsToMany` relation values as
     * `Command.*()` entries or ids; related records created that way go
     * through their own model's hooks too. See createMany().
     *
     * @param {string} modelName
     * @param {Record<string, unknown>} data
     * @param {{ trx?: import('knex').Knex.Transaction }} [options]
     * @returns {Promise<Record<string, unknown>>}
     */
    create(modelName: string, data: Record<string, unknown>, options?: {
        trx?: import('knex').Knex.Transaction;
    }): Promise<Record<string, unknown>>;
    /**
     * Creates many records as tracked entities with a query count that
     * does not grow with the number of records, including any
     * `hasMany` / `belongsToMany` relations named in their payloads.
     * See `createRecords()` (crud/create-many.js) for the mechanics.
     *
     * Per-row hooks still run for every row, in order:
     * `beforeCreate`/`beforeSave` for all rows before anything is
     * written, `afterCreate`/`afterSave` after the whole batch commits
     * (parents first, then any nested children). All-or-nothing.
     *
     * @param {string} modelName
     * @param {Record<string, unknown>[]} dataList
     * @param {{ trx?: import('knex').Knex.Transaction, chunkSize?: number }} [options]
     * @returns {Promise<Record<string, unknown>[]>} entities, in input order
     */
    createMany(modelName: string, dataList: Record<string, unknown>[], options?: {
        trx?: import('knex').Knex.Transaction;
        chunkSize?: number;
    }): Promise<Record<string, unknown>[]>;
    /**
     * Called by a tracked entity's `.save()`. Computes the dirty fields
     * (see diffEntity()) and, if there are none, issues no SQL at all -
     * an unmodified entity's save() is a true no-op. Otherwise runs
     * `beforeUpdate`/`beforeSave` (which may add to `dirty`), issues an
     * UPDATE containing only the dirty columns, refreshes the entity's
     * original snapshot to the new baseline, then runs
     * `afterUpdate`/`afterSave`.
     *
     * If the save fails - a `before*` hook throws, or the DB write
     * itself fails - the entity's live field values are reverted back
     * to `original` before the error propagates. Without this, a
     * rejected save leaves the entity showing whatever the caller had
     * just assigned (never actually persisted) indefinitely, silently
     * diverging from the database until something else happens to
     * overwrite it - found while testing a transition-guard hook that
     * correctly rejected an update, then noticing the in-memory entity
     * kept reporting the rejected value as if it had taken effect.
     *
     * Hooks receive a third argument, `original`: a snapshot of the
     * entity's field values as they were BEFORE this save (captured
     * before `entity`/`original` are mutated with the new values, so
     * before* and after* hooks both see the same pre-edit snapshot
     * consistently). This matters because `entity` itself holds LIVE
     * values - by the time a `beforeUpdate` hook runs, the caller has
     * already mutated `entity` to the new value, so a hook checking
     * `entity.status === "shipped"` to guard against cancelling an
     * already-shipped order would actually see `"cancelled"` (the new
     * value), not `"shipped"` (what it was) - exactly the bug this
     * `original` parameter exists to prevent, found while writing a
     * transition-guard hook for a multi-module example app.
     *
     * @param {Record<string, unknown>} entity
     * @param {{}} [options]
     */
    saveEntity(entity: Record<string, unknown>, options?: {}): Promise<Record<string, unknown>>;
    /**
     * Called by a tracked entity's `.delete()`. Runs `beforeDelete`,
     * issues the DELETE, removes the entity from the identity map, then
     * runs `afterDelete`.
     *
     * @param {Record<string, unknown>} entity
     * @param {{}} [options]
     */
    deleteEntity(entity: Record<string, unknown>, options?: {}): Promise<boolean>;
}
