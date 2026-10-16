/**
 * Puts a model's computed fields onto a record or entity as read-only
 * getters.
 *
 * They are enumerable own properties, so `JSON.stringify(record)`,
 * `{ ...record }` and `Object.keys()` include them like any field -
 * but they are NOT in `model.fields`, which is what every persistence
 * path (prepareWrite, toRow, dirty tracking, schema sync, migrations)
 * iterates, so a computed value can never be written to the database
 * by accident.
 *
 * Each getter calls `compute(target)` afresh: nothing is cached, so the
 * value always reflects the target's current field values, including
 * unsaved in-memory edits on an entity.
 *
 * @template {object} T
 * @param {T} target - a record from fromRow(), or an entity
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {Iterable<string>} [only] - define just these (a record read with `select`); default: all
 * @returns {T}
 */
export declare function defineComputedGetters<T extends object>(target: T, model: import('../models/define-model.js').ModelDescriptor, only?: Iterable<string>): T;
