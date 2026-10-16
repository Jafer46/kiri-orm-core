/**
 * The object behind `client.models.<modelName>`. Wraps a shared
 * UnitOfWork (for entity-returning, identity-mapped, dirty-tracked
 * operations) and a Repository (for bulk operations that don't
 * involve a single tracked instance) for one model.
 *
 * Deliberately always returns tracked entities from find/findOne/
 * create - unlike the lower-level Repository (Phase 5, still
 * available directly for advanced use), which returns plain objects.
 * Mixing both return shapes in one app was a concrete source of
 * confusion found while building a multi-file example; the client
 * facade picks one shape and commits to it everywhere.
 */
export declare class ModelHandle {
    #private;
    unitOfWork: import("../uow/unit-of-work.js").UnitOfWork;
    modelName: string;
    /**
     * @param {import('../uow/unit-of-work.js').UnitOfWork} unitOfWork
     * @param {string} modelName
     */
    constructor(unitOfWork: import('../uow/unit-of-work.js').UnitOfWork, modelName: string);
    /** @param {Record<string, unknown>|unknown[]} [filter] @param {{limit?: number, with?: string[]}} [options] */
    find(filter?: Record<string, unknown> | unknown[], options?: {
        limit?: number;
        with?: string[];
    }): Promise<Record<string, unknown>[]>;
    /** @param {Record<string, unknown>|unknown[]} [filter] @param {{with?: string[]}} [options] */
    findOne(filter?: Record<string, unknown> | unknown[], options?: {
        with?: string[];
    }): Promise<Record<string, unknown> | null>;
    /**
     * @param {Record<string, unknown>} data - field values, plus optional `hasMany` /
     *   `belongsToMany` relation values as `Command.*()` entries or ids
     */
    create(data: Record<string, unknown>): Promise<Record<string, unknown>>;
    /**
     * Creates many records at once, returning tracked entities in input
     * order. Cost does not grow with the number of records: one
     * multi-row INSERT per chunk, plus a fixed number of statements per
     * relation written through `Command.*()` values - so this is the
     * right call for imports, and the way to create related records
     * without `attach()`-ing each parent afterwards.
     *
     * All-or-nothing. Every row is validated before anything is
     * written; errors are keyed by row (`[3].title`). Per-row hooks
     * still run. See `createRecords()` for the full contract.
     *
     * @param {Record<string, unknown>[]} dataList
     * @param {{ chunkSize?: number }} [options]
     */
    createMany(dataList: Record<string, unknown>[], options?: {
        chunkSize?: number;
    }): Promise<Record<string, unknown>[]>;
    /**
     * Bulk update, bypassing the identity map and per-row hooks - for
     * "update every row matching this filter" operations where there's
     * no single entity to track. Named distinctly from entity.save()
     * so the different semantics (no hooks, no dirty-tracking) are
     * visible at the call site rather than implicit.
     *
     * @param {Record<string, unknown>|unknown[]} filter
     * @param {Record<string, unknown>} data
     */
    updateMany(filter: Record<string, unknown> | unknown[], data: Record<string, unknown>): Promise<number>;
    /**
     * Loads relations onto entities you already hold, in one statement per relation - the batched
     * alternative to calling `load()` once per entity (N+1). `spec` is a relation name with its
     * constraints in `options` (`select`, `with`, `where`, `orderBy`, `limit`, `offset`), or a whole
     * `with` value. The entities are changed in place and returned; the related rows are plain records.
     *
     * @param {Record<string, unknown>[]} entities
     * @param {string|string[]|object} spec
     * @param {object} [options]
     */
    loadMany(entities: Record<string, unknown>[], spec: string | string[] | object, options?: object): Promise<Record<string, unknown>[]>;
    /** Loads one relation onto one entity (use loadMany() for several - this is one statement per call). */
    load(entity: any, relationName: any, options?: {}): Promise<unknown>;
    /**
     * One page of entities plus `{ page, perPage, total, pageCount, hasNext, hasPrevious }`.
     * Takes `page`, `perPage`, `total: false`, and anything find() takes. See crud/paginate.js.
     *
     * @param {Record<string, unknown>|unknown[]} [filter]
     * @param {object} [options]
     * @returns {Promise<import('../crud/paginate.js').Page>}
     */
    paginate(filter?: Record<string, unknown> | unknown[], options?: object): Promise<import('../crud/paginate.js').Page>;
    /**
     * Groups rows and computes count / sum / avg / min / max in one query. Plain result rows,
     * nothing tracked. See `Repository.aggregate()` for the options.
     *
     * @param {Record<string, unknown>|unknown[]} [filter]
     * @param {object} options - `{ groupBy, aggregates, orderBy, limit, offset }`
     */
    aggregate(filter?: Record<string, unknown> | unknown[], options?: object): Promise<Record<string, unknown>[]>;
    /** Number of matching rows. @param {Record<string, unknown>|unknown[]} [filter] */
    count(filter?: Record<string, unknown> | unknown[]): Promise<number>;
    /** Sum of a numeric field over the matching rows (null if none). */
    sum(field: any, filter?: {}): Promise<unknown>;
    /** Average of a numeric field over the matching rows (null if none). */
    avg(field: any, filter?: {}): Promise<unknown>;
    /** Smallest value of a field over the matching rows (null if none). */
    min(field: any, filter?: {}): Promise<unknown>;
    /** Largest value of a field over the matching rows (null if none). */
    max(field: any, filter?: {}): Promise<unknown>;
    /**
     * Bulk delete, same rationale as updateMany() - no hooks run.
     * @param {Record<string, unknown>|unknown[]} filter
     */
    deleteMany(filter: Record<string, unknown> | unknown[]): Promise<number>;
    /**
     * Associates one or more related records via a `belongsToMany`
     * relation's pivot table. Existing associations are left alone
     * (not duplicated) rather than erroring on a repeat attach() of the
     * same pair.
     *
     * @param {Record<string, unknown>|number|string} source - an entity or a raw id
     * @param {string} relationName
     * @param {number|string|Array<number|string>} targetIds
     * @returns {Promise<number>} count of new associations actually inserted
     */
    attach(source: Record<string, unknown> | number | string, relationName: string, targetIds: number | string | Array<number | string>): Promise<number>;
    /**
     * Bulk version of attach(): associates many sources with their
     * targets at once. Use this instead of calling attach() in a loop -
     * that costs a couple of queries per source, this costs a handful in
     * total. (To attach relations to records you are *creating*, pass
     * them in the create payload instead; see createMany().)
     *
     * @param {string} relationName
     * @param {Array<{ source: Record<string, unknown>|number|string, targets: number|string|Array<number|string> }>} links
     * @returns {Promise<number>} count of new associations actually inserted
     */
    attachMany(relationName: string, links: Array<{
        source: Record<string, unknown> | number | string;
        targets: number | string | Array<number | string>;
    }>): Promise<number>;
    /**
     * Removes one or more associations via a `belongsToMany` relation's
     * pivot table.
     *
     * @param {Record<string, unknown>|number|string} source
     * @param {string} relationName
     * @param {number|string|Array<number|string>} targetIds
     * @returns {Promise<number>} count of associations removed
     */
    detach(source: Record<string, unknown> | number | string, relationName: string, targetIds: number | string | Array<number | string>): Promise<number>;
}
