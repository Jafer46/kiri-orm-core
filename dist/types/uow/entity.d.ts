/**
 * Symbol-keyed so entity metadata never shows up in Object.keys(),
 * for...in, JSON.stringify(), or spread - the entity looks and
 * behaves exactly like the plain record Repository already returns,
 * with tracking bolted on invisibly rather than requiring a different
 * shape to work with.
 */
export declare const ENTITY_META: unique symbol;
/**
 * Wraps a plain record (as returned by Repository) into a tracked
 * entity: same enumerable field properties, plus a hidden snapshot of
 * the values as-loaded and non-enumerable save()/delete() methods
 * that call whatever `handlers.save`/`handlers.delete` functions the
 * caller supplies.
 *
 * Deliberately decoupled from any particular coordinator object
 * (originally this took a `UnitOfWork` instance directly and called
 * `unitOfWork.saveEntity(entity, ...)`) - `handlers` just needs
 * `save(entity, options)` and `delete(entity, options)` functions,
 * which lets a document be fully self-contained: it can carry
 * everything it needs to save/delete itself without requiring an
 * external identity-map-holding object to mediate. `UnitOfWork` still
 * supplies handlers bound to itself (for identity-mapped, per-
 * transaction use), but the global Mongoose-style `createModel()` API
 * supplies handlers with no external coordinator at all - just a
 * shared connection and hook registry captured in a closure.
 *
 * The entity's live values and its `original` snapshot are built as
 * two SEPARATE clones for mutable field types (see cloneFieldValue) -
 * critical for correctness: without this, `entity.dueDate` and
 * `original.dueDate` would be the same Date object, and mutating one
 * in place would silently mutate the other too, making every
 * in-place edit invisible to diffEntity(). A dedicated test
 * (`flags a date field as dirty when mutated in place`) caught this
 * exact bug during development.
 *
 * @param {Record<string, unknown>} record
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {string} modelName
 * @param {{ save: (entity: object, options?: object) => Promise<unknown>, delete: (entity: object, options?: object) => Promise<unknown> }} handlers
 */
export declare function createEntity(record: Record<string, unknown>, model: import('../models/define-model.js').ModelDescriptor, modelName: string, handlers: {
    save: (entity: object, options?: object) => Promise<unknown>;
    delete: (entity: object, options?: object) => Promise<unknown>;
}): {
    readonly save: (options: any) => Promise<unknown>;
    readonly delete: (options: any) => Promise<unknown>;
};
/**
 * Computes the set of fields whose current value differs from the
 * entity's original (as-loaded) snapshot. Only fields in `model.fields`
 * are considered - relation values attached by eager loading are
 * never part of this, since they aren't persisted columns.
 *
 * @param {Record<string, unknown>} entity
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @returns {Record<string, unknown>}
 */
export declare function diffEntity(entity: Record<string, unknown>, model: import('../models/define-model.js').ModelDescriptor): Record<string, unknown>;
/**
 * Folds a freshly read `record` into an entity that is already tracked (identity-map hit)
 * and returns that entity.
 *
 * The rule the identity map has always had still holds: the in-memory instance wins for any
 * field it already has, because it may carry unsaved edits. What changed with `select` is
 * that the two sides can hold DIFFERENT fields - the entity may have been read partially, or the
 * new read may be - so:
 *
 * - fields the entity doesn't have yet are filled in from the record, in both the live
 *   value and the `original` snapshot, so they start out clean (not dirty);
 * - computed fields the record defines that the entity lacks are defined on it, but only
 *   once everything they depend on is loaded on the entity;
 * - eager-loaded relations are view data, never edited, so they are always refreshed.
 *
 * @param {Record<string, unknown>} entity
 * @param {Record<string, unknown>} record
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @returns {Record<string, unknown>} the same entity
 */
export declare function mergeRecordIntoEntity(entity: Record<string, unknown>, record: Record<string, unknown>, model: import('../models/define-model.js').ModelDescriptor): Record<string, unknown>;
