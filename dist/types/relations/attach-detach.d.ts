/**
 * The batched core behind attach(), attachMany(), and relation
 * payloads on create. Associates any number of (source, target) pairs
 * through a `belongsToMany` relation's pivot table using a constant
 * number of statements: at most one existence check per few hundred
 * sources, plus one INSERT per chunk of rows - never one per pair.
 *
 * Duplicate pairs within `pairs`, and pairs that already exist, are
 * skipped rather than erroring.
 *
 * @param {import('knex').Knex} db - connection or transaction
 * @param {import('./define-relation.js').RelationDescriptor} relation - a belongsToMany relation
 * @param {Array<[number|string, number|string]>} pairs - `[sourceId, targetId]`
 * @param {Object} [options]
 * @param {boolean} [options.checkExisting] - default true. Pass false only when the
 *   sources were created in this same operation (so no association can exist yet),
 *   which skips the existence check entirely; a genuine duplicate then surfaces as
 *   the pivot table's own unique-constraint error instead of being silently skipped.
 * @param {number} [options.chunkSize]
 * @returns {Promise<number>} count of associations actually inserted
 */
export declare function attachPairs(db: import('knex').Knex, relation: import('./define-relation.js').RelationDescriptor, pairs: Array<[number | string, number | string]>, options?: {
    checkExisting?: boolean;
    chunkSize?: number;
}): Promise<number>;
/**
 * Associates one or more related records via a `belongsToMany`
 * relation's pivot table. Existing associations are left alone (not
 * duplicated) rather than erroring on a repeat attach() of the same
 * pair.
 *
 * For many sources at once use attachManyRelation() - calling this in
 * a loop costs a couple of queries per source.
 *
 * @param {import('knex').Knex} db
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {string} modelName
 * @param {Record<string, unknown>|number|string} source - an entity or a raw id
 * @param {string} relationName
 * @param {number|string|Array<number|string>} targetIds
 * @returns {Promise<number>} count of new associations actually inserted
 */
export declare function attachRelation(db: import('knex').Knex, model: import('../models/define-model.js').ModelDescriptor, modelName: string, source: Record<string, unknown> | number | string, relationName: string, targetIds: number | string | Array<number | string>): Promise<number>;
/**
 * Bulk version of attachRelation(): associates many sources with
 * their targets in one go. Cost is independent of how many sources
 * there are - a handful of statements for thousands of associations
 * - which is what makes it the right tool for importing pivot data.
 *
 * @param {import('knex').Knex} db
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {string} modelName
 * @param {string} relationName
 * @param {Array<{ source: Record<string, unknown>|number|string, targets: number|string|Array<number|string> }>} links
 * @param {{ chunkSize?: number }} [options]
 * @returns {Promise<number>} count of new associations actually inserted
 */
export declare function attachManyRelation(db: import('knex').Knex, model: import('../models/define-model.js').ModelDescriptor, modelName: string, relationName: string, links: Array<{
    source: Record<string, unknown> | number | string;
    targets: number | string | Array<number | string>;
}>, options?: {
    chunkSize?: number;
}): Promise<number>;
/**
 * Removes one or more associations via a `belongsToMany` relation's
 * pivot table.
 *
 * @param {import('knex').Knex} db
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {string} modelName
 * @param {Record<string, unknown>|number|string} source
 * @param {string} relationName
 * @param {number|string|Array<number|string>} targetIds
 * @returns {Promise<number>} count of associations removed
 */
export declare function detachRelation(db: import('knex').Knex, model: import('../models/define-model.js').ModelDescriptor, modelName: string, source: Record<string, unknown> | number | string, relationName: string, targetIds: number | string | Array<number | string>): Promise<number>;
