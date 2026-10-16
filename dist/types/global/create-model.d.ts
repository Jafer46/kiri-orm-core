import { HOOK_NAMES } from "../uow/hooks.js";
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
export declare function extendModel(name: string, extension?: {
    fields?: Record<string, object>;
    relations?: Record<string, object>;
    mixins?: string[];
    hooks?: Partial<Record<typeof HOOK_NAMES[number], Function | Function[]>>;
    origin?: string;
}): Model;
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
export declare function defineMixin(name: string, definition: {
    fields: Record<string, object>;
    relations?: Record<string, object>;
    mixins?: string[];
    hooks?: Partial<Record<typeof HOOK_NAMES[number], Function | Function[]>>;
    origin?: string;
}): void;
export type Model = {
    name: string;
    schema: import('../models/define-model.js').ModelDescriptor;
    create: (data: Record<string, unknown>, options?: {
        trx?: object;
    }) => Promise<object>;
    createMany: (dataList: Record<string, unknown>[], options?: {
        trx?: object;
        chunkSize?: number;
    }) => Promise<object[]>;
    find: (filter?: Record<string, unknown> | unknown[], options?: object) => Promise<object[]>;
    findOne: (filter?: Record<string, unknown> | unknown[], options?: object) => Promise<object | null>;
    updateMany: (filter: Record<string, unknown> | unknown[], data: Record<string, unknown>) => Promise<number>;
    deleteMany: (filter: Record<string, unknown> | unknown[]) => Promise<number>;
    loadMany: (documents: object[], spec: string | string[] | object, options?: object) => Promise<object[]>;
    load: (document: object, relationName: string, options?: object) => Promise<unknown>;
    paginate: (filter?: Record<string, unknown> | unknown[], options?: object) => Promise<import('../crud/paginate.js').Page>;
    aggregate: (filter?: Record<string, unknown> | unknown[], options?: object) => Promise<Array<Record<string, unknown>>>;
    count: (filter?: Record<string, unknown> | unknown[], options?: object) => Promise<number>;
    sum: (field: string, filter?: Record<string, unknown> | unknown[], options?: object) => Promise<number | null>;
    avg: (field: string, filter?: Record<string, unknown> | unknown[], options?: object) => Promise<number | null>;
    min: (field: string, filter?: Record<string, unknown> | unknown[], options?: object) => Promise<unknown>;
    max: (field: string, filter?: Record<string, unknown> | unknown[], options?: object) => Promise<unknown>;
    attach: (source: object | number | string, relationName: string, targetIds: unknown) => Promise<number>;
    attachMany: (relationName: string, links: Array<{
        source: object | number | string;
        targets: unknown;
    }>, options?: {
        trx?: object;
    }) => Promise<number>;
    detach: (source: object | number | string, relationName: string, targetIds: unknown) => Promise<number>;
};
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
export declare function createModel(name: string, schema: {
    table?: string;
    fields: Record<string, object>;
    relations?: Record<string, object>;
    mixins?: string[];
    origin?: string;
    hooks?: Partial<Record<typeof HOOK_NAMES[number], Function | Function[]>>;
}): Model;
