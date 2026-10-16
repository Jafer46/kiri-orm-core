import { defineComputedGetters } from "../fields/computed-access.js";
import { PARTIAL } from "../crud/row-mapping.js";
import { expandSelect } from "../crud/select.js";

/**
 * Symbol-keyed so entity metadata never shows up in Object.keys(),
 * for...in, JSON.stringify(), or spread - the entity looks and
 * behaves exactly like the plain record Repository already returns,
 * with tracking bolted on invisibly rather than requiring a different
 * shape to work with.
 */
export const ENTITY_META = Symbol("entityMeta");

/**
 * Deep-clones a field's value where "deep" actually matters for
 * dirty-tracking correctness: Date objects and JSON values are
 * mutable, so entity's live value and its original snapshot need to
 * be genuinely independent objects from the moment the entity is
 * created - not two references to the same object, which a shallow
 * `{...record}` would produce. Every other field type is a JS
 * primitive and is safe to share as-is (primitives can't be mutated
 * in place at all).
 *
 * @param {unknown} value
 * @param {import('../fields/define-field.js').FieldDescriptor} field
 */
function cloneFieldValue(value, field) {
  if (value === null || value === undefined) return value;
  if ((field.type === "date" || field.type === "datetime") && value instanceof Date) {
    return new Date(value.getTime());
  }
  if (field.type === "json") {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  }
  return value;
}

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
export function createEntity(record, model, modelName, handlers) {
  const entity = {};
  const original = {};

  for (const [fieldName, field] of Object.entries(model.fields)) {
    if (!(fieldName in record)) continue;
    entity[fieldName] = cloneFieldValue(record[fieldName], field);
    original[fieldName] = cloneFieldValue(record[fieldName], field);
  }

  // Eager-loaded relation values (attached by Repository's `with`
  // option) aren't persisted columns and are never part of dirty
  // tracking, but still need to be visible on the entity - copied
  // as-is (no cloning needed since diffEntity() never inspects them,
  // only model.fields keys). A real regression during development:
  // the loop above alone (added to fix the Date/JSON in-place-
  // mutation bug) silently dropped eager-loaded relations entirely,
  // since it only ever considered model.fields - caught while
  // building an example combining UnitOfWork with `with` for the
  // first time, which no earlier test happened to do.
  for (const relationName of Object.keys(model.relations ?? {})) {
    if (relationName in record) {
      entity[relationName] = record[relationName];
    }
  }

  // Computed fields read the ENTITY (not the record it was built from), so
  // `entity.firstName = "x"` is reflected by `entity.fullName` immediately.
  // Not part of `original`, so they never appear in dirty tracking.
  // A record read with `select` only carries the computed fields that were asked for (and
  // could be computed from what was loaded) - define just those; see PARTIAL in row-mapping.js.
  defineComputedGetters(entity, model, record[PARTIAL]?.computed);

  Object.defineProperty(entity, ENTITY_META, {
    value: { original, model, modelName },
    enumerable: false,
    writable: true,
    configurable: false,
  });

  Object.defineProperty(entity, "save", {
    value: function save(options) {
      return handlers.save(entity, options);
    },
    enumerable: false,
  });

  Object.defineProperty(entity, "delete", {
    value: function del(options) {
      return handlers.delete(entity, options);
    },
    enumerable: false,
  });

  return entity;
}

/**
 * True if two field values should be considered equal for dirty-
 * tracking purposes.
 *
 * Primitive field types (char, text, integer, float, boolean, enum)
 * use `===`, which already *is* value equality for them.
 *
 * `date`/`datetime` and `json` are handled differently, and
 * deliberately do NOT take a `===` reference-equality shortcut first:
 * doing so would defeat the entire point of comparing by value, since
 * in-place mutation (`entity.dueDate.setDate(...)`,
 * `entity.metadata.tags.push(...)`) leaves the object reference
 * unchanged - `entity[field] === original[field]` stays `true` even
 * though the value's actual content changed. Comparing by moment
 * (`getTime()`) or serialized content (`JSON.stringify`) instead
 * catches that case correctly.
 *
 * @param {unknown} a
 * @param {unknown} b
 * @param {import('../fields/define-field.js').FieldDescriptor} field
 */
function valuesEqual(a, b, field) {
  if (field.type === "date" || field.type === "datetime") {
    const aTime = a instanceof Date ? a.getTime() : a;
    const bTime = b instanceof Date ? b.getTime() : b;
    return aTime === bTime;
  }
  if (field.type === "json") {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return a === b;
    }
  }
  return a === b;
}

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
export function diffEntity(entity, model) {
  const { original } = entity[ENTITY_META];
  const dirty = {};
  for (const [fieldName, field] of Object.entries(model.fields)) {
    if (!valuesEqual(entity[fieldName], original[fieldName], field)) {
      dirty[fieldName] = entity[fieldName];
    }
  }
  return dirty;
}

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
export function mergeRecordIntoEntity(entity, record, model) {
  const { original } = entity[ENTITY_META];

  for (const [fieldName, field] of Object.entries(model.fields)) {
    if (fieldName in record && !(fieldName in original)) {
      entity[fieldName] = cloneFieldValue(record[fieldName], field);
      original[fieldName] = cloneFieldValue(record[fieldName], field);
    }
  }

  const wanted = record[PARTIAL] ? [...record[PARTIAL].computed] : Object.keys(model.computed ?? {});
  const ready = wanted.filter((name) => {
    if (Object.prototype.hasOwnProperty.call(entity, name)) return false;
    for (const dep of expandSelect(model, [name]).fields) if (!(dep in original)) return false;
    return true;
  });
  if (ready.length > 0) defineComputedGetters(entity, model, ready);

  for (const relationName of Object.keys(model.relations ?? {})) {
    if (relationName in record) entity[relationName] = record[relationName];
  }
  return entity;
}
