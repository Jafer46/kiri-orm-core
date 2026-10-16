import { ValidationError } from "../crud/errors.js";
import { buildAggregateQuery, countAggregateGroups, runAggregate } from "../crud/aggregate.js";
import { filterToAst } from "../crud/aggregate-filter.js";
import { planAggregate } from "../crud/aggregate-spec.js";
import { defaultFieldTypeRegistry } from "../fields/default-registry.js";
import { toAggregateOptions } from "./define-report.js";
import { ReportDefinitionError } from "./errors.js";

/**
 * Runs a report (see defineReport()). Every call is one SQL statement, whatever the grain,
 * the number of aggregates, or the relations they cross.
 *
 * It is a thin layer over `aggregate()`: the report's fields are translated into `groupBy` /
 * `aggregates`, its `where` is ANDed in front of the caller's filter, and computed fields are applied to
 * the rows afterwards. So everything aggregate() guarantees holds here too - to-many aggregates
 * can't inflate each other, a filter on an aggregate becomes HAVING, buckets are UTC, nulls sort last.
 *
 * The filter you pass to `find()` is written in terms of the REPORT's fields:
 * `[["customerName", "=", "Ada"], ["revenue", ">", 1000]]`. A condition on a key field filters rows
 * before grouping; on an aggregate, groups after.
 *
 * Models are looked up on first use, not at definition, so a report may be defined before the
 * models it reads. The first use also validates the whole definition against them.
 */
export class ReportHandle {
  #descriptor;
  #env;
  #prepared = null;

  /**
   * @param {import('./define-report.js').ReportDescriptor} descriptor
   * @param {object} env - how to reach the database and models, looked up at call time so a report
   *   follows its client (and a transaction) rather than capturing one connection
   * @param {() => import('knex').Knex} env.db
   * @param {() => import('../models/registry.js').ModelRegistry} env.registry
   * @param {import('../fields/registry.js').FieldTypeRegistry} [env.fieldTypeRegistry]
   */
  constructor(descriptor, env) {
    this.#descriptor = descriptor;
    this.#env = env;
  }

  get name() {
    return this.#descriptor.name;
  }

  /** The (frozen) definition: `{ name, from, where, orderBy, fields }`. */
  get descriptor() {
    return this.#descriptor;
  }

  /**
   * The rows of the report matching `filter`.
   *
   * @param {Record<string, unknown>|unknown[]} [filter] - in terms of the report's fields
   * @param {{ orderBy?: unknown, limit?: number, offset?: number, trx?: import('knex').Knex.Transaction }} [options]
   *   `orderBy` defaults to the report's own. Computed fields can't be filtered or sorted by.
   * @returns {Promise<Array<Record<string, unknown>>>} plain objects, fields in the order the report declares them
   */
  async find(filter = {}, options = {}) {
    const run = this.#prepare(filter, options);
    const rows = await runAggregate(run.ctx);
    return rows.map(run.finish);
  }

  /** The first row (in the report's order) matching `filter`, or `null`. */
  async findOne(filter = {}, options = {}) {
    const [row] = await this.find(filter, { ...options, limit: 1 });
    return row ?? null;
  }

  /**
   * How many rows (groups) the report has for `filter` - ignoring orderBy and paging. One statement.
   * @returns {Promise<number>}
   */
  async count(filter = {}, options = {}) {
    return countAggregateGroups(this.#prepare(filter, options).ctx);
  }

  /** The SQL (and bindings) `find()` would run, without running it. Handy for inspecting or EXPLAINing a report. */
  toSQL(filter = {}, options = {}) {
    const { query } = buildAggregateQuery(this.#prepare(filter, options).ctx);
    return query.toSQL().toNative();
  }

  #prepare(filter, options) {
    const descriptor = this.#descriptor;
    const registry = this.#env.registry();
    const model = this.#modelFor(registry);
    const computed = Object.entries(descriptor.fields).filter(([, f]) => f.kind === "computed");
    const computedNames = new Set(computed.map(([name]) => name));

    checkFilterFields(filterToAst(filter), descriptor, computedNames, model);
    const orderBy = options.orderBy ?? descriptor.orderBy;
    for (const entry of orderEntries(orderBy)) {
      if (computedNames.has(entry)) {
        throw new ValidationError(model.name, {
          orderBy: [`"${entry}" is a computed field of report "${descriptor.name}", calculated in JavaScript after the query - the database can't sort by it.`],
        });
      }
    }

    const fieldTypeRegistry = this.#env.fieldTypeRegistry ?? defaultFieldTypeRegistry;
    const ctx = {
      db: options.trx ?? this.#env.db(),
      model,
      filter: [...toTerms(descriptor.where), ...toTerms(filter)],
      options: { ...this.#prepared.aggregateOptions, orderBy, limit: options.limit, offset: options.offset },
      fieldTypeRegistry,
      modelRegistry: registry,
    };

    const fieldNames = Object.keys(descriptor.fields);
    const finish = (row) => {
      for (const [name, field] of computed) row[name] = field.compute(row);
      return Object.fromEntries(fieldNames.map((name) => [name, row[name]])); // declared order, computed in place
    };
    return { ctx, finish };
  }

  /** Looks the model up and validates the whole definition against it, once per model instance. */
  #modelFor(registry) {
    const descriptor = this.#descriptor;
    const model = registry.getModel(descriptor.from); // throws UnknownModelError naming the valid models
    if (this.#prepared?.model === model) return model;

    const aggregateOptions = toAggregateOptions(descriptor);
    try {
      planAggregate(model, { ...aggregateOptions, orderBy: descriptor.orderBy }, registry);
      filterToAst(descriptor.where); // the report's own `where` must at least parse
    } catch (error) {
      if (error instanceof ValidationError) {
        const detail = Object.entries(error.fieldErrors).map(([option, messages]) => `${option}: ${messages.join("; ")}`).join(" | ");
        throw new ReportDefinitionError(descriptor.name, detail, { cause: error });
      }
      throw error;
    }
    this.#prepared = { model, aggregateOptions };
    return model;
  }
}

/** A filter written as an object or an array, as an array of conditions (so two can be ANDed by concatenation). */
function toTerms(filter) {
  if (Array.isArray(filter)) return filter;
  return Object.entries(filter ?? {}).map(([field, value]) => [field, "=", value]);
}

function orderEntries(orderBy) {
  if (orderBy === undefined || orderBy === null) return [];
  const items = Array.isArray(orderBy) && !(orderBy.length === 2 && ["asc", "desc"].includes(String(orderBy[1]).toLowerCase())) ? orderBy : [orderBy];
  return items.map((item) => {
    if (typeof item === "string") return item.startsWith("-") ? item.slice(1) : item;
    if (Array.isArray(item)) return item[0];
    return item?.field;
  });
}

/**
 * A report's filter speaks the report's own language: its key and aggregate fields, nothing else.
 * (Its `where` is the place to constrain the underlying model.) Otherwise a dashboard would quietly
 * expose every column of the table it reads.
 */
function checkFilterFields(node, descriptor, computedNames, model) {
  if (node.type !== "leaf") {
    node.children.forEach((child) => checkFilterFields(child, descriptor, computedNames, model));
    return;
  }
  const fail = (message) => {
    throw new ValidationError(model.name, { filter: [message] });
  };
  if (computedNames.has(node.field)) {
    fail(`"${node.field}" is a computed field of report "${descriptor.name}", calculated in JavaScript after the query, so it can't be filtered. Use the fields it depends on.`);
  }
  if (!Object.prototype.hasOwnProperty.call(descriptor.fields, node.field)) {
    const filterable = Object.entries(descriptor.fields).filter(([, f]) => f.kind !== "computed").map(([name]) => name);
    fail(`"${node.field}" is not a field of report "${descriptor.name}". Filterable fields: ${filterable.join(", ")}`);
  }
}
