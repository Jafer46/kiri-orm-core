import { ON_DELETE_ACTIONS } from "./define-relation.js";
/**
 * Whether deleting a row of `modelName` needs anything beyond a plain `DELETE ... WHERE ...`
 * - i.e. whether a `constraint: false` relation points at it. Anything else is handled by the
 * database's own foreign keys. Pure registry inspection, no query.
 *
 * @param {import('../models/registry.js').ModelRegistry} modelRegistry
 * @param {string} modelName
 * @returns {boolean}
 */
export declare function hasIncomingRelations(modelRegistry: import('../models/registry.js').ModelRegistry, modelName: string): boolean;
/**
 * Entry point used by Repository#delete(): resolves `where` to actual
 * ids, then deletes them with full cascade/restrict/setNull handling,
 * in one transaction (joining `options.trx` if given, opening one
 * otherwise) so a `"restrict"` refusal or a mid-cascade failure leaves
 * nothing changed.
 *
 * @param {import('knex').Knex} db
 * @param {import('../models/registry.js').ModelRegistry} modelRegistry
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {(qb: import('knex').Knex.QueryBuilder) => void} where - as built by resolveWhere()
 * @param {{ trx?: import('knex').Knex.Transaction }} [options]
 * @returns {Promise<number>} rows of `model` deleted
 */
export declare function deleteRowsWithCascade(db: import('knex').Knex, modelRegistry: import('../models/registry.js').ModelRegistry, model: import('../models/define-model.js').ModelDescriptor, where: (qb: import('knex').Knex.QueryBuilder) => void, options?: {
    trx?: import('knex').Knex.Transaction;
}): Promise<number>;
export { ON_DELETE_ACTIONS };
