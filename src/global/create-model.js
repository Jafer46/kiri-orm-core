import { Repository } from "../crud/repository.js";
import { createEntity, diffEntity, mergeRecordIntoEntity, ENTITY_META } from "../uow/entity.js";
import { withPrimaryKey } from "../crud/select.js";
import { paginateWith } from "../crud/paginate.js";
import { HOOK_NAMES } from "../uow/hooks.js";
import { attachRelation, attachManyRelation, detachRelation } from "../relations/attach-detach.js";
import { createRecords } from "../crud/create-many.js";
import { assertPrimaryKeyUntouched } from "../crud/prepare-write.js";
import { defaultFieldTypeRegistry } from "../fields/default-registry.js";
import { getConnection } from "./connect.js";
import { state } from "./state.js";
import { currentIdentityMap } from "./identity-scope.js";
import { primaryKeyOf } from "../models/primary-key.js";

const assertKnownHooks = (name, hooks) => {
  for (const hookName of Object.keys(hooks)) {
    if (!HOOK_NAMES.includes(hookName)) {
      throw new TypeError(`Model "${name}": unknown hook "${hookName}". Valid hooks: ${HOOK_NAMES.join(", ")}`);
    }
  }
};

function registerHooks(name, hooks) {
  if (!hooks) return;
  assertKnownHooks(name, hooks);
  for (const [hookName, handlerOrHandlers] of Object.entries(hooks)) {
    const handlers = Array.isArray(handlerOrHandlers) ? handlerOrHandlers : [handlerOrHandlers];
    for (const fn of handlers) state.hooks.on(name, hookName, fn);
  }
}

/** Accumulates `hooks` onto whatever `mixinName` already has in `state.mixinHooks` (concatenating per hook name, not replacing). */
function addMixinHooks(mixinName, hooks) {
  if (!hooks) return;
  assertKnownHooks(mixinName, hooks);
  const merged = { ...state.mixinHooks.get(mixinName) };
  for (const [hookName, handlerOrHandlers] of Object.entries(hooks)) {
    const incoming = Array.isArray(handlerOrHandlers) ? handlerOrHandlers : [handlerOrHandlers];
    merged[hookName] = [...(merged[hookName] ?? []), ...incoming];
  }
  state.mixinHooks.set(mixinName, merged);
}

/**
 * Extends a model that some other package defined - Odoo's `_inherit`
 * on an existing model. Adds fields and relations to it (or overrides
 * their options: `{ title: { required: true } }` keeps the field's type
 * and everything else), and can register hooks for it. Same model,
 * same table; the additions are ordinary columns.
 *
 * Call order doesn't matter. If the model isn't defined yet, the
 * extension waits and is applied the moment `createModel(name)` runs -
 * which is what lets independent packages extend each other's models
 * without agreeing on an import order.
 *
 * An override can change a field's options but not its `type`, and
 * can't turn a stored field into a computed one (or back): either would
 * silently change a column.
 *
 * Returns the SAME Model object `createModel(name)` returns - there is
 * only ever one per model name, shared by everyone who calls either
 * function for it - so it is usable straight away, whether
 * `createModel(name)` ran before this or hasn't run yet:
 *
 *   export const OrderInvoice = extendModel("invoice", {
 *     fields: { orderId: { type: "integer", required: true, unique: true } },
 *     relations: { order: { type: "belongsTo", model: "order", foreignKey: "orderId" } },
 *   });
 *   await OrderInvoice.create({ id: 1, orderId: 7, amountCents: 4200 });
 *
 * The model doesn't need to exist yet for this to work (the extension
 * itself waits, same as always, until `createModel(name)` defines it -
 * see ModelRegistry) - but every one of `OrderInvoice`'s methods does a
 * real database read or write, so calling one before the base model is
 * defined and `syncModels()` has run fails the way it always would.
 *
 * `extension.hooks` on a MIXIN (a name defined with `defineMixin`, not
 * `createModel`) needs the mixin already defined - see `defineMixin()`'s
 * docstring for why hooks on a mixin work differently from its fields.
 *
 * @param {string} name - the model to extend
 * @param {Object} extension
 * @param {Record<string, object>} [extension.fields]
 * @param {Record<string, object>} [extension.relations]
 * @param {string[]} [extension.mixins]
 * @param {Partial<Record<typeof HOOK_NAMES[number], Function|Function[]>>} [extension.hooks]
 * @param {string} [extension.origin] - the contributing package's name, for error messages and `schema.origins`
 * @returns {Model}
 */
export function extendModel(name, extension = {}) {
  const { fields, relations, mixins, hooks, origin } = extension;
  const targetIsMixin = state.registry.isAbstract(name);
  if (hooks && !targetIsMixin) assertKnownHooks(name, hooks); // before anything is registered
  state.registry.define({ extend: name, fields, relations, mixins }, { origin });
  if (targetIsMixin) addMixinHooks(name, hooks);
  else registerHooks(name, hooks);
  return getOrCreateModelHandle(name);
}

/**
 * Defines an abstract model: fields and relations (and, unlike a plain
 * `createModel()` schema, hooks too) that other models pull in with
 * `mixins: [name]`. It has no table and no query methods of its own.
 *
 * A model picks up a mixin's hooks - alongside its fields and relations -
 * at the moment IT is created, following whatever the mixin has at that
 * point; they run before the model's own hooks of the same name. That
 * makes the ordering requirement the mirror image of everything else in
 * this file: `defineMixin(name, { hooks })` (or `extendModel(name, {
 * hooks })` once the mixin already exists) must happen BEFORE
 * `createModel(other, { mixins: [name] })`, not after. This is narrower
 * than how a mixin's FIELDS behave - extending a mixin's fields later
 * reaches every model already using it, because fields are just data
 * folded into a descriptor on demand. A hook is a live registration
 * against a running `HookRegistry`; reaching backwards into models that
 * already resolved would mean either firing the same handler twice for
 * models processed once already, or building a way to tell "already
 * applied" apart from "new since last time" - real complexity for a
 * pattern (adding a hook to a mixin after code already depends on it)
 * that's rare in practice. Declare a mixin's hooks up front.
 *
 * @param {string} name
 * @param {Object} definition
 * @param {Record<string, object>} definition.fields
 * @param {Record<string, object>} [definition.relations]
 * @param {string[]} [definition.mixins]
 * @param {Partial<Record<typeof HOOK_NAMES[number], Function|Function[]>>} [definition.hooks]
 * @param {string} [definition.origin]
 */
export function defineMixin(name, definition) {
  const { fields, relations, mixins, hooks, origin } = definition;
  state.registry.define({ name, abstract: true, fields, relations, mixins }, { origin });
  addMixinHooks(name, hooks);
}

/**
 * @typedef {Object} Model
 * @property {string} name
 * @property {import('../models/define-model.js').ModelDescriptor} schema
 * @property {(data: Record<string, unknown>, options?: { trx?: object }) => Promise<object>} create
 * @property {(dataList: Record<string, unknown>[], options?: { trx?: object, chunkSize?: number }) => Promise<object[]>} createMany
 * @property {(filter?: Record<string, unknown>|unknown[], options?: object) => Promise<object[]>} find
 * @property {(filter?: Record<string, unknown>|unknown[], options?: object) => Promise<object|null>} findOne
 * @property {(filter: Record<string, unknown>|unknown[], data: Record<string, unknown>) => Promise<number>} updateMany
 * @property {(filter: Record<string, unknown>|unknown[]) => Promise<number>} deleteMany
 * @property {(documents: object[], spec: string|string[]|object, options?: object) => Promise<object[]>} loadMany
 * @property {(document: object, relationName: string, options?: object) => Promise<unknown>} load
 * @property {(filter?: Record<string, unknown>|unknown[], options?: object) => Promise<import('../crud/paginate.js').Page>} paginate
 * @property {(filter?: Record<string, unknown>|unknown[], options?: object) => Promise<Array<Record<string, unknown>>>} aggregate
 * @property {(filter?: Record<string, unknown>|unknown[], options?: object) => Promise<number>} count
 * @property {(field: string, filter?: Record<string, unknown>|unknown[], options?: object) => Promise<number|null>} sum
 * @property {(field: string, filter?: Record<string, unknown>|unknown[], options?: object) => Promise<number|null>} avg
 * @property {(field: string, filter?: Record<string, unknown>|unknown[], options?: object) => Promise<unknown>} min
 * @property {(field: string, filter?: Record<string, unknown>|unknown[], options?: object) => Promise<unknown>} max
 * @property {(source: object|number|string, relationName: string, targetIds: unknown) => Promise<number>} attach
 * @property {(relationName: string, links: Array<{ source: object|number|string, targets: unknown }>, options?: { trx?: object }) => Promise<number>} attachMany
 * @property {(source: object|number|string, relationName: string, targetIds: unknown) => Promise<number>} detach
 */

/**
 * Defines a model against the shared default registry/connection and
 * returns a `Model` object you can export and import anywhere - no
 * `client`, `UnitOfWork`, or registry needs to be threaded through by
 * hand at the call site, the same way a Mongoose model works once
 * `mongoose.connect()` has been called once at startup.
 *
 * Every document `create()`/`find()`/`findOne()` returns is
 * self-contained: it carries its own `.save()`/`.delete()` that know
 * how to persist themselves using this Model's shared connection and
 * hooks, with no external "unit of work" object needed. There is
 * deliberately no identity map here - two `find()` calls for the same
 * row return two DIFFERENT object instances, same as Mongoose. Dirty
 * tracking doesn't need one: each document independently remembers
 * its own as-loaded values (see `uow/entity.js`), so this is a real
 * simplification, not a missing feature. For the cases that do need
 * one, wrap the work in `withIdentityMap(fn)`: inside it every
 * find/create returns one instance per row, scoped to that call (see
 * identity-scope.js). A `UnitOfWork`/`createClient()` also has one.
 *
 * Hooks are declared inline, Mongoose-style, rather than through a
 * separately-constructed `HookRegistry` the caller has to remember to
 * pass around: `{ hooks: { beforeCreate(data) {...} } }`. Each hook
 * name maps to one function or an array of functions (run in order).
 *
 * @param {string} name
 * @param {Object} schema
 * @param {string} [schema.table]
 * @param {Record<string, object>} schema.fields
 * @param {Record<string, object>} [schema.relations]
 * @param {string[]} [schema.mixins] - abstract models (see defineMixin) whose fields this model includes
 * @param {string} [schema.origin]
 * @param {Partial<Record<typeof HOOK_NAMES[number], Function|Function[]>>} [schema.hooks]
 * @returns {Model}
 */
export function createModel(name, schema) {
  const { fields, relations, hooks, table, mixins, origin } = schema;
  // Returns null (rather than throwing) if `mixins` names a model that doesn't exist yet: the
  // model then simply waits for it. Either way the Model below works once everything is defined.
  const descriptorNow = state.registry.define({ name, table, fields, relations, mixins }, { origin });

  // A mixin's hooks are picked up here, at creation time - see defineMixin()'s docstring for
  // why that's a deliberate, one-time pull rather than something a later mixin change reaches
  // backwards for. Only possible once every mixin `name` uses is actually resolved (descriptorNow
  // non-null); if this model is still pending on a mixin that isn't defined yet, its OWN fields
  // still resolve normally later (unaffected), but it will not pick up hooks from mixins at all -
  // define mixins before the models that use them if you want their hooks.
  if (descriptorNow) {
    for (const mixinName of state.registry.mixinsOf(name)) {
      registerHooks(name, state.mixinHooks.get(mixinName));
    }
  }
  registerHooks(name, hooks); // the model's own hooks run after its mixins' hooks of the same name
  return getOrCreateModelHandle(name);
}

/**
 * Builds (or returns the already-built) Model object for `name` -
 * `createModel` and `extendModel` share this, so extending a model
 * before or after `createModel(name)` hands back the SAME object
 * rather than a second, disconnected one. Building it doesn't require
 * the model to be registered yet: everything inside reads the
 * registry lazily (`descriptor()`), so the object works immediately
 * once the model - or the last thing it was waiting on - is defined.
 */
function getOrCreateModelHandle(name) {
  const existing = state.models.get(name);
  if (existing) return existing;

  // Looked up on every use rather than captured once: another package may extend this
  // model at any point (see extendModel), replacing the registry's descriptor for it,
  // and a captured one would silently keep describing the model as it was first defined.
  const descriptor = () => state.registry.getModel(name);

  function repo() {
    return new Repository(getConnection(), descriptor(), undefined, state.registry);
  }

  function identityKey(id) {
    return `${name}:${id}`;
  }

  function wrapDocument(record) {
    // Outside withIdentityMap() every call builds a fresh document.
    const identityMap = currentIdentityMap();
    const key = primaryKeyOf(descriptor());
    const tracked = identityMap && key !== null && record[key] !== undefined && record[key] !== null;

    if (tracked && identityMap.has(identityKey(record[key]))) {
      // Same rule as UnitOfWork: the in-memory instance wins for field values it already has,
      // missing fields are filled in, relations are refreshed (see mergeRecordIntoEntity()).
      return mergeRecordIntoEntity(identityMap.get(identityKey(record[key])), record, descriptor());
    }

    const document = createEntity(record, descriptor(), name, {
      save: saveDocument,
      delete: deleteDocument,
    });
    if (tracked) identityMap.set(identityKey(record[key]), document);
    return document;
  }
  state.wrappers.set(name, wrapDocument);

  // Related records created through Command.create() belong to other
  // models; each one is wrapped by its own model's wrapper.
  function createRuntime(options) {
    return {
      db: options.trx ?? getConnection(),
      modelRegistry: state.registry,
      fieldTypeRegistry: defaultFieldTypeRegistry,
      hooks: state.hooks,
      wrap: (modelName, record) => state.wrappers.get(modelName)?.(record) ?? record,
    };
  }

  async function saveDocument(entity, options = {}) {
    const dirty = diffEntity(entity, descriptor());
    if (Object.keys(dirty).length === 0) return entity;

    const original = entity[ENTITY_META].original;
    const originalSnapshot = { ...original };

    try {
      assertPrimaryKeyUntouched(descriptor(), dirty); // before any hook sees an id change
      await state.hooks.run(name, "beforeUpdate", entity, dirty, originalSnapshot);
      await state.hooks.run(name, "beforeSave", entity, dirty, originalSnapshot);
      await repo().update({ [primaryKeyOf(descriptor())]: original[primaryKeyOf(descriptor())] }, dirty, options);
    } catch (err) {
      for (const key of Object.keys(dirty)) entity[key] = original[key];
      throw err;
    }

    for (const [key, value] of Object.entries(dirty)) {
      entity[key] = value;
      original[key] = value;
    }

    await state.hooks.run(name, "afterUpdate", entity, dirty, originalSnapshot);
    await state.hooks.run(name, "afterSave", entity, dirty, originalSnapshot);
    return entity;
  }

  async function deleteDocument(entity, options = {}) {
    const original = entity[ENTITY_META].original;
    await state.hooks.run(name, "beforeDelete", entity);
    const key = primaryKeyOf(descriptor());
    await repo().delete({ [key]: original[key] }, options);
    currentIdentityMap()?.delete(identityKey(original[key]));
    await state.hooks.run(name, "afterDelete", entity);
    return true;
  }

  const handle = {
    name,
    get schema() {
      return descriptor();
    },

    /**
     * @param {Record<string, unknown>} data - field values, plus optional `hasMany` / `belongsToMany`
     *   relation values as `Command.*()` entries or ids
     * @param {{ trx?: import('knex').Knex.Transaction }} [options] - pass `{ trx }` from runInTransaction() to include this write in an ongoing transaction
     */
    async create(data, options = {}) {
      const [entity] = await createRecords(createRuntime(options), descriptor(), [data], {
        trx: options.trx,
        labels: [""],
      });
      return entity;
    },

    /**
     * Creates many documents at once. Cost does not grow with the
     * number of documents: one multi-row INSERT per chunk plus a fixed
     * number of statements per relation written via `Command.*()`
     * values. All-or-nothing (a transaction is opened for you unless
     * you pass `{ trx }`), every row is validated before anything is
     * written, and per-row hooks still run.
     *
     * @param {Record<string, unknown>[]} dataList
     * @param {{ trx?: import('knex').Knex.Transaction, chunkSize?: number }} [options]
     */
    async createMany(dataList, options = {}) {
      return createRecords(createRuntime(options), descriptor(), dataList, options);
    },

    /**
     * `select` limits the fields read; the primary key is always included so the document can
     * save itself and take part in the identity map. `with` takes names, paths or
     * `{ relation: { select, with } }`. Returned documents can be saved: only fields that
     * were loaded can change, and only those are written.
     *
     * @param {{ trx?: import('knex').Knex.Transaction, limit?: number, select?: string[], with?: string[]|object }} [options]
     */
    async find(filter = {}, options = {}) {
      const records = await repo().find(filter, withPrimaryKey(descriptor(), options));
      return records.map(wrapDocument);
    },

    /** @param {{ trx?: import('knex').Knex.Transaction, with?: string[] }} [options] */
    async findOne(filter = {}, options = {}) {
      const results = await repo().find(filter, withPrimaryKey(descriptor(), { ...options, limit: 1 }));
      return results.length > 0 ? wrapDocument(results[0]) : null;
    },

    /** @param {{ trx?: import('knex').Knex.Transaction }} [options] */
    async updateMany(filter, data, options = {}) {
      return repo().update(filter, data, options);
    },

    /** @param {{ trx?: import('knex').Knex.Transaction }} [options] */
    async deleteMany(filter, options = {}) {
      return repo().delete(filter, options);
    },

    /**
     * Loads relations onto documents you already hold, in one statement per relation: the batched
     * alternative to calling `load()` per document (N+1). `spec` is a relation name with its
     * constraints in `options` (`select`, `with`, `where`, `orderBy`, `limit`, `offset`), or a whole
     * `with` value. Documents are changed in place and returned; related rows are plain records.
     */
    async loadMany(documents, spec, options = {}) {
      return repo().loadMany(documents, spec, options);
    },

    /** Loads one relation onto one document (one statement per call - use loadMany() for several). */
    async load(document, relationName, options = {}) {
      return repo().load(document, relationName, options);
    },

    /**
     * One page of documents plus `{ page, perPage, total, pageCount, hasNext, hasPrevious }`.
     * Takes `page`, `perPage`, `total: false`, and anything find() takes. See crud/paginate.js.
     */
    async paginate(filter = {}, options = {}) {
      return paginateWith(
        { modelName: name, count: (f, o) => handle.count(f, o), find: (f, o) => handle.find(f, o) },
        filter,
        options
      );
    },

    /**
     * One-statement group-and-aggregate; plain result rows, nothing tracked or put in the identity map.
     * See `Repository.aggregate()` for `groupBy`, `aggregates`, `orderBy`, `limit`, `offset`.
     */
    async aggregate(filter = {}, options = {}) {
      return repo().aggregate(filter, options);
    },

    /** Number of matching rows. @param {{ trx?: import('knex').Knex.Transaction }} [options] */
    async count(filter = {}, options = {}) {
      return repo().count(filter, options);
    },

    /** Sum of a numeric field over the matching rows (null if none). */
    async sum(field, filter = {}, options = {}) {
      return repo().sum(field, filter, options);
    },

    /** Average of a numeric field over the matching rows (null if none). */
    async avg(field, filter = {}, options = {}) {
      return repo().avg(field, filter, options);
    },

    /** Smallest value of a field over the matching rows (null if none). */
    async min(field, filter = {}, options = {}) {
      return repo().min(field, filter, options);
    },

    /** Largest value of a field over the matching rows (null if none). */
    async max(field, filter = {}, options = {}) {
      return repo().max(field, filter, options);
    },

    /** @param {{ trx?: import('knex').Knex.Transaction }} [options] */
    async attach(source, relationName, targetIds, options = {}) {
      const db = options.trx ?? getConnection();
      return attachRelation(db, descriptor(), name, source, relationName, targetIds);
    },

    /**
     * Bulk attach(): many sources at once, a handful of queries in total
     * instead of a couple per source.
     *
     * @param {Array<{ source: object|number|string, targets: number|string|Array<number|string> }>} links
     * @param {{ trx?: import('knex').Knex.Transaction }} [options]
     */
    async attachMany(relationName, links, options = {}) {
      const db = options.trx ?? getConnection();
      return attachManyRelation(db, descriptor(), name, relationName, links);
    },

    /** @param {{ trx?: import('knex').Knex.Transaction }} [options] */
    async detach(source, relationName, targetIds, options = {}) {
      const db = options.trx ?? getConnection();
      return detachRelation(db, descriptor(), name, source, relationName, targetIds);
    },
  };
  state.models.set(name, handle);
  return handle;
}
