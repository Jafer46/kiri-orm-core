/**
 * The CRUD surface for a single model. Every method speaks in field
 * names and JS-native value types (Dates, booleans, parsed JSON) -
 * column names, casting, and raw Knex calls are all handled
 * internally, so a caller never needs to write SQL or touch Knex
 * directly to manage rows of a model.
 *
 * Every method accepts an optional `{ trx }` in its options so a
 * caller can run several operations as one atomic unit via Knex's own
 * transaction API - see runInTransaction() in transaction.js for a
 * thin convenience wrapper around `db.transaction()`.
 *
 * `find`/`findOne` accept `{ with: ["relationName", ...] }` to
 * eager-load relations (Phase 7) - this requires a `modelRegistry` to
 * be supplied at construction time, since resolving a relation means
 * looking up its target model. `load()` does the same for a single
 * already-fetched record (lazy loading).
 *
 * They also accept `{ select: ["field", ...] }` to read only some columns (Phase 14), and
 * `with` can narrow each relation the same way: `{ with: { author: { select: ["name"] } } }`.
 */
export declare class Repository {
    #private;
    db: import("knex").Knex<any, any[]>;
    model: import("../models/define-model.js").ModelDescriptor;
    fieldTypeRegistry: import("../fields/registry.js").FieldTypeRegistry;
    modelRegistry: import("../models/registry.js").ModelRegistry | undefined;
    /**
     * @param {import('knex').Knex} db
     * @param {import('../models/define-model.js').ModelDescriptor} model
     * @param {import('../fields/registry.js').FieldTypeRegistry} [fieldTypeRegistry]
     * @param {import('../models/registry.js').ModelRegistry} [modelRegistry] - required for `with`/`load()`
     */
    constructor(db: import('knex').Knex, model: import('../models/define-model.js').ModelDescriptor, fieldTypeRegistry?: import('../fields/registry.js').FieldTypeRegistry, modelRegistry?: import('../models/registry.js').ModelRegistry);
    /**
     * Validates `data` against the model (applying defaults for any
     * field not provided), inserts one row, and returns the created
     * record as read back from the DB - so DB-level defaults and any
     * driver-side coercion are reflected in what's returned.
     *
     * `data` may also carry `hasMany` / `belongsToMany` relation values
     * as `Command.*()` entries or ids (see `Command`), which are
     * written in the same operation; that requires a `modelRegistry`.
     * A plain create with no relation values is still exactly one
     * INSERT.
     *
     * @param {Record<string, unknown>} data
     * @param {{ trx?: import('knex').Knex.Transaction }} [options]
     * @returns {Promise<Record<string, unknown>>}
     * @throws {ValidationError}
     */
    create(data: Record<string, unknown>, options?: {
        trx?: import('knex').Knex.Transaction;
    }): Promise<Record<string, unknown>>;
    /**
     * Creates many records at once, with a query count that does not
     * grow with the number of records: one multi-row INSERT per chunk
     * (chunked to what the dialect allows), plus a fixed number of
     * statements per relation written via `Command.*()` values - however
     * many rows carry them. All-or-nothing: runs in a single transaction
     * (yours, if you pass `{ trx }`), so a failure part-way leaves
     * nothing behind.
     *
     * Validation runs on every row before anything is written, and
     * failures are reported per row (`[3].title`).
     *
     * @param {Record<string, unknown>[]} dataList
     * @param {{ trx?: import('knex').Knex.Transaction, chunkSize?: number }} [options]
     * @returns {Promise<Record<string, unknown>[]>} stored records, in input order
     * @throws {ValidationError}
     */
    createMany(dataList: Record<string, unknown>[], options?: {
        trx?: import('knex').Knex.Transaction;
        chunkSize?: number;
    }): Promise<Record<string, unknown>[]>;
    /**
     * Finds records matching `filter`, which may be either a plain
     * equality object (`{ status: "paid" }`, Phase 5) or a domain array
     * (`[["status", "=", "paid"]]`, Phase 8 - supports comparisons,
     * `in`/`not in`, `like`/`ilike`, and nested `&`/`|`/`!` groups).
     *
     * `select` limits which fields are read (default: all). Stored and computed fields
     * are both accepted; a computed field brings the stored fields it depends on along with it,
     * and they appear on the record too. The primary key is NOT added for you here - ask for it
     * if you want it (the `client.models` and `createModel()` APIs always include it, because
     * a document needs it to save). Join keys needed by `with` are read but not returned
     * unless selected.
     *
     * `with` loads relations in one extra query per relation per level, and takes a name, a
     * dotted path, or an object that narrows each relation - see relations/with-spec.js:
     * `{ author: { select: ["name"] }, comments: { select: ["body"], with: ["user"] } }`.
     *
     * @param {Record<string, unknown>|unknown[]} [filter]
     * @param {{ trx?: import('knex').Knex.Transaction, limit?: number, offset?: number,
     *   orderBy?: string|string[]|Array<[string, "asc"|"desc"]>|{field: string, direction?: "asc"|"desc"},
     *   select?: string[], with?: string[]|object }} [options]
     * @returns {Promise<Record<string, unknown>[]>}
     * @throws {ValidationError} `select` names an unknown field (here or inside `with`)
     * @throws {RelationError} `with` names an unknown relation or option
     */
    find(filter?: Record<string, unknown> | unknown[], options?: {
        trx?: import('knex').Knex.Transaction;
        limit?: number;
        offset?: number;
        orderBy?: string | string[] | Array<[string, "asc" | "desc"]> | {
            field: string;
            direction?: "asc" | "desc";
        };
        select?: string[];
        with?: string[] | object;
    }): Promise<Record<string, unknown>[]>;
    /**
     * Groups rows and computes count / sum / avg / min / max over them, in one SQL statement.
     *
     * ```js
     * await repo.aggregate([["status", "!=", "cancelled"], ["revenue", ">", 1000]], {
     *   groupBy: ["customerId", "placedAt:month"],
     *   aggregates: { orders: "count", revenue: { sum: "total" }, biggest: { max: "total" } },
     *   orderBy: "-revenue",
     *   limit: 10,
     * });
     * // [{ customerId: 7, placedAt_month: Date, orders: 12, revenue: 5400, biggest: 900 }, ...]
     * ```
     *
     * `filter` is written like find()'s and may mention both ordinary fields and the
     * aggregates' names: conditions on rows run before grouping (WHERE), conditions on an
     * aggregate after (HAVING), sorted out for you - see aggregate-filter.js. A condition that
     * mixes the two inside an OR or NOT is rejected.
     *
     * `groupBy`: a field, `"dateField:bucket"` (hour, day, week, month, quarter, year - always UTC,
     * weeks start Monday), or `{ field, bucket, as }`; an array of those. `aggregates`:
     * `{ name: "count" }` counts rows, otherwise `{ name: { fn: "field" } }` with fn one of
     * count (non-null values), countDistinct, sum, avg, min, max. With no `groupBy` the result is a
     * single row. Computed fields can't be grouped or aggregated (the database can't see them).
     *
     * Fields may be reached through relations with a dotted path. Through a to-one relation
     * (`customer.company.country`) a field can be grouped by or aggregated. Through a to-many relation
     * (`items.amount`, `tags.name`, or `{ count: "items" }`) it can only be aggregated, and each parent still
     * counts once: the related rows are first collapsed to one subtotal per parent (see aggregate.js), so
     * `sum("total")` next to `sum("items.amount")` is never inflated by the number of items.
     *
     * Always returns an array of plain objects (counts, sums and averages as numbers, min/max in the
     * field's own type, a bucket as the Date it starts at). Not entities: nothing is tracked.
     *
     * @param {Record<string, unknown>|unknown[]} [filter]
     * @param {{ groupBy?: unknown, aggregates?: Record<string, unknown>, orderBy?: unknown,
     *   limit?: number, offset?: number, trx?: import('knex').Knex.Transaction }} options
     * @returns {Promise<Array<Record<string, unknown>>>}
     * @throws {ValidationError} anything wrong with `groupBy`, `aggregates`, `orderBy` or the `filter`
     */
    aggregate(filter?: Record<string, unknown> | unknown[], options?: {
        groupBy?: unknown;
        aggregates?: Record<string, unknown>;
        orderBy?: unknown;
        limit?: number;
        offset?: number;
        trx?: import('knex').Knex.Transaction;
    }): Promise<Array<Record<string, unknown>>>;
    /**
     * Number of rows matching `filter` (any filter find() accepts).
     * @param {Record<string, unknown>|unknown[]} [filter]
     * @param {{ trx?: import('knex').Knex.Transaction }} [options]
     * @returns {Promise<number>}
     */
    count(filter?: Record<string, unknown> | unknown[], options?: {
        trx?: import('knex').Knex.Transaction;
    }): Promise<number>;
    /** Sum of a numeric field over the matching rows; `null` when no row has a value. */
    sum(field: any, filter?: {}, options?: {}): Promise<unknown>;
    /** Average of a numeric field over the matching rows; `null` when no row has a value. */
    avg(field: any, filter?: {}, options?: {}): Promise<unknown>;
    /** Smallest value of a field over the matching rows (a Date for a date field); `null` when none. */
    min(field: any, filter?: {}, options?: {}): Promise<unknown>;
    /** Largest value of a field over the matching rows; `null` when none. */
    max(field: any, filter?: {}, options?: {}): Promise<unknown>;
    /**
     * Like find(), but returns the first match or null. Useful for
     * lookups expected to match at most one row (e.g. a unique field).
     * Accepts `with` the same as find().
     *
     * @param {Record<string, unknown>} [filter]
     * @param {{ trx?: import('knex').Knex.Transaction, select?: string[], with?: string[]|object }} [options]
     * @returns {Promise<Record<string, unknown>|null>}
     */
    findOne(filter?: Record<string, unknown>, options?: {
        trx?: import('knex').Knex.Transaction;
        select?: string[];
        with?: string[] | object;
    }): Promise<Record<string, unknown> | null>;
    /**
     * Lazily loads one relation for one already-fetched record, attaches it onto `record` under
     * `relationName` (same as eager loading would) and returns it. It is `loadMany([record], ...)`.
     *
     * Calling this in a loop is the classic N+1: one statement per record. If you have several records,
     * call loadMany() once - it costs one statement for all of them.
     *
     * @param {Record<string, unknown>} record
     * @param {string} relationName
     * @param {{ trx?: import('knex').Knex.Transaction, select?: string[], with?: string[]|object,
     *   where?: unknown, orderBy?: unknown, limit?: number, offset?: number }} [options] - as for one entry of `with`
     * @returns {Promise<unknown>}
     */
    load(record: Record<string, unknown>, relationName: string, options?: {
        trx?: import('knex').Knex.Transaction;
        select?: string[];
        with?: string[] | object;
        where?: unknown;
        orderBy?: unknown;
        limit?: number;
        offset?: number;
    }): Promise<unknown>;
    /**
     * Loads relations onto a whole set of already-fetched records, in ONE statement per relation
     * (two for a belongsToMany with no ordering or limit) however many records there are - the same
     * batched loader `find({ with })` uses, for when you already hold the records.
     *
     * ```js
     * const posts = await repo.find({ status: "draft" });
     * await repo.loadMany(posts, "author");                                        // one relation
     * await repo.loadMany(posts, "comments", { orderBy: "-likes", limit: 3 });     // constrained: each post's top 3
     * await repo.loadMany(posts, ["author", { tags: { select: ["name"] } }]);     // several, in any `with` shape
     * ```
     *
     * `spec` is a relation name (its constraints in `options`: `select`, `with`, `where`, `orderBy`,
     * `limit`, `offset`, exactly as one entry of `find({ with })`), or any whole `with` value. Records are
     * changed in place and the same array is returned. An empty array sends nothing (the spec is still
     * checked). Every record must carry the field its relation is matched by (a belongsTo's foreign key,
     * otherwise its local key); one read with a `select` that left it out gets a RelationError naming it.
     *
     * @param {Record<string, unknown>[]} records
     * @param {string|string[]|object} spec
     * @param {{ trx?: import('knex').Knex.Transaction, select?: string[], with?: string[]|object,
     *   where?: unknown, orderBy?: unknown, limit?: number, offset?: number }} [options] - only with a relation name
     * @returns {Promise<Record<string, unknown>[]>} `records`
     */
    loadMany(records: Record<string, unknown>[], spec: string | string[] | object, options?: {
        trx?: import('knex').Knex.Transaction;
        select?: string[];
        with?: string[] | object;
        where?: unknown;
        orderBy?: unknown;
        limit?: number;
        offset?: number;
    }): Promise<Record<string, unknown>[]>;
    /**
     * One page of rows plus the numbers a pager needs; see paginate.js.
     *
     * @param {Record<string, unknown>|unknown[]} [filter]
     * @param {{ page?: number, perPage?: number, total?: boolean }} [options] - and anything find() takes
     * @returns {Promise<import('./paginate.js').Page>}
     */
    paginate(filter?: Record<string, unknown> | unknown[], options?: {
        page?: number;
        perPage?: number;
        total?: boolean;
    }): Promise<import('./paginate.js').Page>;
    /**
     * Validates and casts `data` (partial: only the provided fields are
     * touched, no defaults applied), then updates every row matching
     * `filter` (plain equality object or domain array - see find()).
     * Requires at least one field in `data` - an accidental
     * `update(filter, {})` is a caller bug, not a valid no-op, so it
     * throws rather than silently doing nothing. The primary key can't be
     * part of `data` at all (see assertPrimaryKeyUntouched()).
     *
     * @param {Record<string, unknown>|unknown[]} filter
     * @param {Record<string, unknown>} data
     * @param {{ trx?: import('knex').Knex.Transaction }} [options]
     * @returns {Promise<number>} count of rows updated
     * @throws {ValidationError}
     */
    update(filter: Record<string, unknown> | unknown[], data: Record<string, unknown>, options?: {
        trx?: import('knex').Knex.Transaction;
    }): Promise<number>;
    /**
     * Deletes every row matching `filter` (plain equality object or
     * domain array - see find()). Requires a non-empty filter -
     * `delete({})` or `delete([])` would silently wipe the whole table,
     * which is almost never what's intended, so both are rejected
     * outright rather than treated as "delete everything".
     *
     * @param {Record<string, unknown>|unknown[]} filter
     * @param {{ trx?: import('knex').Knex.Transaction }} [options]
     * @returns {Promise<number>} count of rows deleted
     */
    delete(filter: Record<string, unknown> | unknown[], options?: {
        trx?: import('knex').Knex.Transaction;
    }): Promise<number>;
}
/**
 * @param {import('knex').Knex} db
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {import('../fields/registry.js').FieldTypeRegistry} [fieldTypeRegistry]
 * @param {import('../models/registry.js').ModelRegistry} [modelRegistry]
 * @returns {Repository}
 */
export declare function createRepository(db: import('knex').Knex, model: import('../models/define-model.js').ModelDescriptor, fieldTypeRegistry?: import('../fields/registry.js').FieldTypeRegistry, modelRegistry?: import('../models/registry.js').ModelRegistry): Repository;
