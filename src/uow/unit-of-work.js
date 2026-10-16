import { defaultFieldTypeRegistry } from "../fields/default-registry.js";
import { Repository } from "../crud/repository.js";
import { createEntity, diffEntity, mergeRecordIntoEntity, ENTITY_META } from "./entity.js";
import { HookRegistry } from "./hooks.js";
import { createRecords } from "../crud/create-many.js";
import { assertPrimaryKeyUntouched } from "../crud/prepare-write.js";
import { withPrimaryKey } from "../crud/select.js";
import { primaryKeyOf } from "../models/primary-key.js";

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
export class UnitOfWork {
  /**
   * @param {import('knex').Knex} db
   * @param {import('../models/registry.js').ModelRegistry} modelRegistry
   * @param {Object} [options]
   * @param {import('../fields/registry.js').FieldTypeRegistry} [options.fieldTypeRegistry]
   * @param {HookRegistry} [options.hooks]
   * @param {import('knex').Knex.Transaction} [options.trx]
   */
  constructor(db, modelRegistry, options = {}) {
    this.db = db;
    this.modelRegistry = modelRegistry;
    this.fieldTypeRegistry = options.fieldTypeRegistry ?? defaultFieldTypeRegistry;
    this.hooks = options.hooks ?? new HookRegistry();
    this.trx = options.trx;
    this.identityMap = new Map(); // `${modelName}:${pkValue}` -> entity
  }

  #repositoryFor(modelName) {
    const model = this.modelRegistry.getModel(modelName);
    return { model, repo: new Repository(this.trx ?? this.db, model, this.fieldTypeRegistry, this.modelRegistry) };
  }

  #identityKey(modelName, pkValue) {
    return `${modelName}:${pkValue}`;
  }

  /**
   * Wraps a freshly-fetched record as a tracked entity, reusing the
   * existing instance from the identity map if this row (by primary
   * key, the "id" convention used throughout) is already tracked.
   * When reused, the EXISTING in-memory instance wins over the fresh
   * DB read - a second `find()` doesn't clobber unsaved in-progress
   * edits with whatever's currently in the database.
   */
  #trackOrReuse(modelName, model, record) {
    const pk = primaryKeyOf(model);
    const key = this.#identityKey(modelName, pk === null ? undefined : record[pk]);
    if (this.identityMap.has(key)) {
      // Field values already on the cached instance win (it may hold unsaved edits); fields it
      // doesn't have yet are filled in, and relations are refreshed. See mergeRecordIntoEntity().
      return mergeRecordIntoEntity(this.identityMap.get(key), record, model);
    }
    const entity = createEntity(record, model, modelName, {
      save: (e, options) => this.saveEntity(e, options),
      delete: (e, options) => this.deleteEntity(e, options),
    });
    this.identityMap.set(key, entity);
    return entity;
  }

  /**
   * @param {string} modelName
   * @param {Record<string, unknown>|unknown[]} [filter]
   * @param {{ limit?: number, with?: string[] }} [options]
   * @returns {Promise<Record<string, unknown>[]>}
   */
  async find(modelName, filter = {}, options = {}) {
    const { model, repo } = this.#repositoryFor(modelName);
    // A tracked entity needs its primary key to save, delete and be found in the identity map.
    const records = await repo.find(filter, withPrimaryKey(model, options));
    return records.map((record) => this.#trackOrReuse(modelName, model, record));
  }

  /**
   * @param {string} modelName
   * @param {Record<string, unknown>|unknown[]} [filter]
   * @param {{ with?: string[] }} [options]
   * @returns {Promise<Record<string, unknown>|null>}
   */
  async findOne(modelName, filter = {}, options = {}) {
    const results = await this.find(modelName, filter, { ...options, limit: 1 });
    return results[0] ?? null;
  }

  #createRuntime() {
    return {
      db: this.trx ?? this.db,
      modelRegistry: this.modelRegistry,
      fieldTypeRegistry: this.fieldTypeRegistry,
      hooks: this.hooks,
      wrap: (modelName, record) => this.#trackOrReuse(modelName, this.modelRegistry.getModel(modelName), record),
    };
  }

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
  async create(modelName, data, options = {}) {
    const model = this.modelRegistry.getModel(modelName);
    const [entity] = await createRecords(this.#createRuntime(), model, [data], { ...options, labels: [""] });
    return entity;
  }

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
  async createMany(modelName, dataList, options = {}) {
    const model = this.modelRegistry.getModel(modelName);
    return createRecords(this.#createRuntime(), model, dataList, options);
  }

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
  async saveEntity(entity, options = {}) {
    const { model, modelName, original } = entity[ENTITY_META];
    const dirty = diffEntity(entity, model);

    if (Object.keys(dirty).length === 0) {
      return entity;
    }

    const originalSnapshot = { ...original };

    try {
      assertPrimaryKeyUntouched(model, dirty); // before any hook sees an id change
      await this.hooks.run(modelName, "beforeUpdate", entity, dirty, originalSnapshot);
      await this.hooks.run(modelName, "beforeSave", entity, dirty, originalSnapshot);

      const { repo } = this.#repositoryFor(modelName);
      const pk = primaryKeyOf(model);
      await repo.update({ [pk]: original[pk] }, dirty, options);
    } catch (err) {
      // Nothing was persisted - revert entity's live values to match
      // what's actually in the database rather than leaving them at
      // whatever the caller had just (unsuccessfully) tried to save.
      for (const key of Object.keys(dirty)) {
        entity[key] = original[key];
      }
      throw err;
    }

    // Write dirty's final values onto both entity and original - not
    // entity's (possibly stale) value into original. A before* hook
    // may have added a field to `dirty` that the caller never touched
    // directly (e.g. auto-stamping `publishedAt`), and the entity
    // itself needs to reflect that too, not just the database.
    for (const [key, value] of Object.entries(dirty)) {
      entity[key] = value;
      original[key] = value;
    }

    await this.hooks.run(modelName, "afterUpdate", entity, dirty, originalSnapshot);
    await this.hooks.run(modelName, "afterSave", entity, dirty, originalSnapshot);

    return entity;
  }

  /**
   * Called by a tracked entity's `.delete()`. Runs `beforeDelete`,
   * issues the DELETE, removes the entity from the identity map, then
   * runs `afterDelete`.
   *
   * @param {Record<string, unknown>} entity
   * @param {{}} [options]
   */
  async deleteEntity(entity, options = {}) {
    const { model, modelName, original } = entity[ENTITY_META];

    await this.hooks.run(modelName, "beforeDelete", entity);

    const { repo } = this.#repositoryFor(modelName);
    const pk = primaryKeyOf(model);
    await repo.delete({ [pk]: original[pk] }, options);

    this.identityMap.delete(this.#identityKey(modelName, original[pk]));

    await this.hooks.run(modelName, "afterDelete", entity);

    return true;
  }
}
