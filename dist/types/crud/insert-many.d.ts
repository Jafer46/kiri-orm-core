/**
 * @param {import('knex').Knex} db - a Knex instance or transaction
 * @returns {{ maxRows: number, maxParams: number }}
 */
export declare function insertLimitsFor(db: import('knex').Knex): {
    maxRows: number;
    maxParams: number;
};
/**
 * How many rows of `columnCount` columns fit in one INSERT on this
 * connection. `requested` can only lower the answer, never raise it
 * above what the dialect can actually execute.
 *
 * @param {import('knex').Knex} db
 * @param {number} columnCount
 * @param {number} [requested]
 * @returns {number}
 */
export declare function rowsPerStatement(db: import('knex').Knex, columnCount: number, requested?: number): number;
/**
 * @template T
 * @param {T[]} items
 * @param {number} size
 * @returns {T[][]}
 */
export declare function chunkArray<T>(items: T[], size: number): T[][];
/**
 * Pairs each INSERT ... RETURNING row back up with the input row that
 * produced it.
 *
 * Both Postgres and SQLite return rows in insertion order in
 * practice, and that is the fast path here. But nothing in either
 * SQL standard guarantees it, and getting it wrong is not a cosmetic
 * bug: a hasMany child or pivot row would be attached to the wrong
 * parent, silently. So the fast path is *verified* against each row's
 * `id` (the primary-key convention used throughout this ORM), and if
 * any pair disagrees, rows are matched by `id` instead. A model with
 * no `id` field has nothing to verify against and stays positional.
 *
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {Record<string, unknown>[]} valuesList - validated field values, in input order
 * @param {Record<string, unknown>[]} records - returned records, in whatever order the DB used
 * @returns {Record<string, unknown>[]} records in input order
 */
export declare function alignToInput(model: import('../models/define-model.js').ModelDescriptor, valuesList: Record<string, unknown>[], records: Record<string, unknown>[]): Record<string, unknown>[];
/**
 * Inserts many already-validated rows with as few statements as the
 * dialect allows - one INSERT ... RETURNING per chunk - and returns
 * the stored records, cast back into field values, in input order.
 *
 * This does NOT open a transaction: with more than one chunk the
 * caller is responsible for atomicity (see createRecords()).
 *
 * @param {import('knex').Knex} db - connection or transaction
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {Record<string, unknown>[]} valuesList - output of prepareWrite(...).values, one per row
 * @param {import('../fields/registry.js').FieldTypeRegistry} fieldTypeRegistry
 * @param {{ chunkSize?: number }} [options]
 * @returns {Promise<Record<string, unknown>[]>}
 */
export declare function insertRecords(db: import('knex').Knex, model: import('../models/define-model.js').ModelDescriptor, valuesList: Record<string, unknown>[], fieldTypeRegistry: import('../fields/registry.js').FieldTypeRegistry, options?: {
    chunkSize?: number;
}): Promise<Record<string, unknown>[]>;
