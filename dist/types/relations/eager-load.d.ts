/**
 * Loads every relation named in `withSpec` for `records`, mutating each record in place and
 * returning the same array. A no-op for an empty `records` array (no queries issued at all).
 *
 * `withSpec` is anything `find({ with })` accepts (see with-spec.js): relation names,
 * dotted paths, and/or `{ relation: { select, with } }` objects. It is validated up front,
 * before any query runs.
 *
 * Supports dot-path nesting - `"items.product"` loads `items` on
 * `model` first (one batched query), then recurses onto every loaded
 * item to load `product` on THEM (another batched query, deduplicated
 * by object reference first so records that share the same related
 * row - e.g. many order items pointing at the same product - aren't
 * redundantly re-queried). Arbitrary depth works the same way,
 * recursively: `"items.product.tags"` loads three levels, each still
 * one query per level regardless of how many records are at that
 * level - the N+1 guarantee holds at every depth, not just the first.
 * Field selection changes which columns each of those queries reads, never how many run.
 *
 * @param {import('knex').Knex} db
 * @param {import('../models/registry.js').ModelRegistry} modelRegistry
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {Record<string, unknown>[]} records
 * @param {unknown} withSpec - relation names / paths / `{ relation: { select, with } }`
 * @param {import('../fields/registry.js').FieldTypeRegistry} fieldTypeRegistry
 * @returns {Promise<Record<string, unknown>[]>}
 */
export declare function eagerLoad(db: import('knex').Knex, modelRegistry: import('../models/registry.js').ModelRegistry, model: import('../models/define-model.js').ModelDescriptor, records: Record<string, unknown>[], withSpec: unknown, fieldTypeRegistry: import('../fields/registry.js').FieldTypeRegistry): Promise<Record<string, unknown>[]>;
