export type CreateRuntime = {
    /**
     * - connection used unless `options.trx` overrides it
     */
    db: import('knex').Knex;
    /**
     * - needed only when payloads contain relations
     */
    modelRegistry?: import('../models/registry.js').ModelRegistry;
    fieldTypeRegistry: import('../fields/registry.js').FieldTypeRegistry;
    /**
     * - omit for hook-free creation (plain Repository)
     */
    hooks?: import('../uow/hooks.js').HookRegistry;
    /**
     * - turns a stored record into what callers
     * get back (a tracked entity); omit to return plain records
     */
    wrap?: (modelName: string, record: Record<string, unknown>) => object;
};
/**
 * Creates every record in `dataList` (and any relations named in
 * their payloads) with a query count independent of how many there are.
 * All-or-nothing: if anything fails, nothing is written.
 *
 * @param {CreateRuntime} runtime
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {Record<string, unknown>[]} dataList
 * @param {Object} [options]
 * @param {import('knex').Knex.Transaction} [options.trx] - run inside this transaction instead of opening one
 * @param {number} [options.chunkSize] - lower the rows-per-INSERT below the dialect's limit
 * @param {string[]} [options.labels] - per-row prefixes for validation error keys; defaults to
 *   `[0]`, `[1]`, ...; `create()` passes `[""]` so its error keys stay plain field names
 * @returns {Promise<object[]>} one result per input, in input order (`runtime.wrap`'s output, else the stored record)
 * @throws {ValidationError} row-level problems, keyed by row (`[3].title`, `[3].items[1].quantity`)
 * @throws {RelationError} malformed relation payloads
 */
export declare function createRecords(runtime: CreateRuntime, model: import('../models/define-model.js').ModelDescriptor, dataList: Record<string, unknown>[], options?: {
    trx?: import('knex').Knex.Transaction;
    chunkSize?: number;
    labels?: string[];
}): Promise<object[]>;
