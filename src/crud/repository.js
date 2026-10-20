import { defaultFieldTypeRegistry } from "../fields/default-registry.js";
import { prepareWrite, assertPrimaryKeyUntouched } from "./prepare-write.js";
import { resolveWhere, isEmptyFilter } from "./resolve-where.js";
import { fromRow, toRow } from "./row-mapping.js";
import { applyOrderAndPaging } from "./order.js";
import { ValidationError } from "./errors.js";
import { eagerLoad } from "../relations/eager-load.js";
import { normalizeWith, parentKeysNeeded } from "../relations/with-spec.js";
import { normalizeSelect, planSelect, stripHidden } from "./select.js";
import { runAggregate } from "./aggregate.js";
import { paginateWith } from "./paginate.js";
import {
  hasIncomingRelations,
  deleteRowsWithCascade,
} from "../relations/cascade-delete.js";
import { translateDeleteError } from "../relations/foreign-keys.js";
import { createRecords } from "./create-many.js";
import { RelationError } from "../relations/errors.js";

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
export class Repository {
  /**
   * @param {import('knex').Knex} db
   * @param {import('../models/define-model.js').ModelDescriptor} model
   * @param {import('../fields/registry.js').FieldTypeRegistry} [fieldTypeRegistry]
   * @param {import('../models/registry.js').ModelRegistry} [modelRegistry] - required for `with`/`load()`
   */
  constructor(
    db,
    model,
    fieldTypeRegistry = defaultFieldTypeRegistry,
    modelRegistry = undefined,
  ) {
    this.db = db;
    this.model = model;
    this.fieldTypeRegistry = fieldTypeRegistry;
    this.modelRegistry = modelRegistry;
  }

  #queryBuilder(trx) {
    return (trx ?? this.db)(this.model.tableName);
  }

  #createRuntime() {
    return {
      db: this.db,
      modelRegistry: this.modelRegistry,
      fieldTypeRegistry: this.fieldTypeRegistry,
    };
  }

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
  async create(data, options = {}) {
    const [record] = await createRecords(
      this.#createRuntime(),
      this.model,
      [data],
      { trx: options.trx, labels: [""] },
    );
    return record;
  }

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
  async createMany(dataList, options = {}) {
    return createRecords(this.#createRuntime(), this.model, dataList, options);
  }

  #requireModelRegistry(forWhat) {
    if (!this.modelRegistry) {
      throw new RelationError(
        `${forWhat} requires this Repository to have been constructed with a modelRegistry ` +
          `(the 4th constructor argument, or use RepositoryFactory which supplies it automatically).`,
      );
    }
    return this.modelRegistry;
  }

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
  async find(filter = {}, options = {}) {
    // Everything user-supplied is validated before the first query is sent.
    const names = normalizeSelect(this.model, options.select);
    const tree = hasWith(options.with)
      ? normalizeWith(
          this.model,
          this.#requireModelRegistry("find() with `with`"),
          options.with,
          this.fieldTypeRegistry,
        )
      : new Map();
    const plan = planSelect(
      this.model,
      names,
      tree.size > 0
        ? parentKeysNeeded(this.model, this.modelRegistry, tree)
        : [],
    );

    const where = resolveWhere(
      this.model,
      filter,
      this.fieldTypeRegistry,
      this.modelRegistry,
    );
    let query = this.#queryBuilder(options.trx).where(where);
    if (plan.columns) query = query.select(plan.columns);
    query = applyOrderAndPaging(query, this.model, options);

    const rows = await query;
    const records = rows.map((row) =>
      fromRow(this.model, row, this.fieldTypeRegistry, {
        computed: plan.computed,
      }),
    );

    if (tree.size > 0) {
      await eagerLoad(
        options.trx ?? this.db,
        this.modelRegistry,
        this.model,
        records,
        tree,
        this.fieldTypeRegistry,
      );
    }
    stripHidden(records, plan.hidden);

    return records;
  }

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
  async aggregate(filter = {}, options = {}) {
    return runAggregate({
      db: options.trx ?? this.db,
      model: this.model,
      filter,
      options,
      fieldTypeRegistry: this.fieldTypeRegistry,
      modelRegistry: this.modelRegistry,
    });
  }

  /**
   * Number of rows matching `filter` (any filter find() accepts).
   * @param {Record<string, unknown>|unknown[]} [filter]
   * @param {{ trx?: import('knex').Knex.Transaction }} [options]
   * @returns {Promise<number>}
   */
  async count(filter = {}, options = {}) {
    return this.#single(filter, options, "count", null) ?? 0;
  }

  /** Sum of a numeric field over the matching rows; `null` when no row has a value. */
  async sum(field, filter = {}, options = {}) {
    return this.#single(filter, options, "sum", field);
  }

  /** Average of a numeric field over the matching rows; `null` when no row has a value. */
  async avg(field, filter = {}, options = {}) {
    return this.#single(filter, options, "avg", field);
  }

  /** Smallest value of a field over the matching rows (a Date for a date field); `null` when none. */
  async min(field, filter = {}, options = {}) {
    return this.#single(filter, options, "min", field);
  }

  /** Largest value of a field over the matching rows; `null` when none. */
  async max(field, filter = {}, options = {}) {
    return this.#single(filter, options, "max", field);
  }

  async #single(filter, options, fn, field) {
    // The name only has to avoid clashing with a field; a leading double underscore does.
    const spec = field === null ? "count" : { [fn]: field };
    const [row] = await this.aggregate(filter, {
      trx: options.trx,
      aggregates: { __value: spec },
    });
    return row.__value;
  }

  /**
   * Like find(), but returns the first match or null. Useful for
   * lookups expected to match at most one row (e.g. a unique field).
   * Accepts `with` the same as find().
   *
   * @param {Record<string, unknown>} [filter]
   * @param {{ trx?: import('knex').Knex.Transaction, select?: string[], with?: string[]|object }} [options]
   * @returns {Promise<Record<string, unknown>|null>}
   */
  async findOne(filter = {}, options = {}) {
    const rows = await this.find(filter, { ...options, limit: 1 });
    return rows[0] ?? null;
  }

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
  async load(record, relationName, options = {}) {
    await this.loadMany([record], relationName, options);
    return record[relationName];
  }

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
  async loadMany(records, spec, options = {}) {
    const modelRegistry = this.#requireModelRegistry("loadMany()");
    const { trx, ...constraints } = options;
    const withSpec = typeof spec === "string" ? { [spec]: constraints } : spec;
    await eagerLoad(
      trx ?? this.db,
      modelRegistry,
      this.model,
      records,
      withSpec,
      this.fieldTypeRegistry,
    );
    return records;
  }

  /**
   * One page of rows plus the numbers a pager needs; see paginate.js.
   *
   * @param {Record<string, unknown>|unknown[]} [filter]
   * @param {{ page?: number, perPage?: number, total?: boolean }} [options] - and anything find() takes
   * @returns {Promise<import('./paginate.js').Page>}
   */
  async paginate(filter = {}, options = {}) {
    return paginateWith(
      {
        modelName: this.model.name,
        count: (f, o) => this.count(f, o),
        find: (f, o) => this.find(f, o),
      },
      filter,
      options,
    );
  }

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
  async update(filter, data, options = {}) {
    if (isEmptyFilter(filter)) {
      throw new ValidationError(this.model.name, {
        _: [
          "update() requires a non-empty filter - use a filter that matches everything explicitly if that's really intended",
        ],
      });
    }
    assertPrimaryKeyUntouched(this.model, data);
    const { errors, values } = prepareWrite(
      this.model,
      data,
      { partial: true },
      this.fieldTypeRegistry,
    );
    if (Object.keys(errors).length > 0) {
      throw new ValidationError(this.model.name, errors);
    }
    if (Object.keys(values).length === 0) {
      throw new ValidationError(this.model.name, {
        _: ["update() requires at least one field to update"],
      });
    }

    const where = resolveWhere(
      this.model,
      filter,
      this.fieldTypeRegistry,
      this.modelRegistry,
    );
    const row = toRow(this.model, values);
    return this.#queryBuilder(options.trx).where(where).update(row);
  }

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
  async delete(filter, options = {}) {
    if (isEmptyFilter(filter)) {
      throw new ValidationError(this.model.name, {
        _: [
          "delete() requires a non-empty filter - use a filter that matches everything explicitly if that's really intended",
        ],
      });
    }

    const where = resolveWhere(
      this.model,
      filter,
      this.fieldTypeRegistry,
      this.modelRegistry,
    );

    // Referential integrity (restrict / set null / cascade) is enforced by the database's own
    // foreign keys, so this is one statement. Only a model that a `constraint: false` relation
    // points at takes the slower path, where the ORM applies onDelete itself.
    try {
      if (!hasIncomingRelations(this.modelRegistry, this.model.name)) {
        return await this.#queryBuilder(options.trx).where(where).delete();
      }
      return await deleteRowsWithCascade(
        this.db,
        this.modelRegistry,
        this.model,
        where,
        options,
      );
    } catch (error) {
      throw translateDeleteError(error, this.model.name);
    }
  }
}

/** True unless `with` is absent or empty (`[]`, `{}`), so a bare find() never needs a modelRegistry. */
function hasWith(input) {
  if (input === undefined || input === null) return false;
  if (Array.isArray(input)) return input.length > 0;
  if (typeof input === "object") return Object.keys(input).length > 0;
  return true; // a string etc.: let normalizeWith() reject it with a useful message
}

/**
 * @param {import('knex').Knex} db
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {import('../fields/registry.js').FieldTypeRegistry} [fieldTypeRegistry]
 * @param {import('../models/registry.js').ModelRegistry} [modelRegistry]
 * @returns {Repository}
 */
export function createRepository(
  db,
  model,
  fieldTypeRegistry = defaultFieldTypeRegistry,
  modelRegistry = undefined,
) {
  return new Repository(db, model, fieldTypeRegistry, modelRegistry);
}
