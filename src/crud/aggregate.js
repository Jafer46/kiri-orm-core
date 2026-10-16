import { castValue } from "../fields/cast-value.js";
import { compileParsedDomain } from "../domain/compile.js";
import { dateBucketSql, parseBucket } from "../dialect/date-bucket.js";
import { planAggregate } from "./aggregate-spec.js";
import { compileHaving, filterToAst, mentionsResultColumn, splitFilter } from "./aggregate-filter.js";
import { resolveWhere } from "./resolve-where.js";

/**
 * Builds and runs one aggregate query: groups rows, computes count/sum/avg/min/max, filters
 * before and after grouping, and returns plain result rows. Always exactly ONE statement,
 * however many groups, aggregates, or relations are involved - there is no per-group or
 * per-parent follow-up query, so no N+1.
 *
 * Reads are plain: no entities, no identity map, no hooks, no `save()`. A result row is a
 * summary of many records, not any one of them. See Repository.aggregate() for the options.
 *
 * ## Following relations without distorting the numbers
 *
 * Fields reached through a to-one relation (`customer.country`) are LEFT JOINed: a row has at
 * most one customer, so the row count can't change.
 *
 * A to-many relation (`items.amount`) can't be joined - `sum(order.total)` over orders joined
 * to their items counts every order once per item. Instead each to-many relation gets its own
 * subquery that collapses the related rows to ONE ROW PER PARENT:
 *
 *   LEFT JOIN (SELECT order_id AS k, sum(amount) AS s0, count(amount) AS c0
 *              FROM item GROUP BY order_id) AS m1 ON m1.k = order.id
 *
 * so parents still appear exactly once, and the outer query combines the per-parent subtotals:
 * count and sum add up, min/max take the min/max, and avg is total-sum / total-count (NOT an
 * average of averages, which would weight a parent with one item the same as one with fifty).
 * countDistinct can't be assembled from subtotals, so it isn't offered across a to-many.
 *
 * When any relation is involved, the filtered base rows are wrapped as a derived table with the
 * model's own name, so the WHERE half of the filter keeps its plain unqualified column names and
 * runs before any join. With no relation the query has no derived table and no joins.
 *
 * @param {object} ctx
 * @param {import('knex').Knex} ctx.db - connection or transaction
 * @param {import('../models/define-model.js').ModelDescriptor} ctx.model
 * @param {Record<string, unknown>|unknown[]} ctx.filter
 * @param {object} ctx.options
 * @param {import('../fields/registry.js').FieldTypeRegistry} ctx.fieldTypeRegistry
 * @param {import('../models/registry.js').ModelRegistry} [ctx.modelRegistry]
 * @param {boolean} [withOrder] - false when only the number of groups is wanted
 * @returns {{ query: import('knex').Knex.QueryBuilder, plan: import('./aggregate-spec.js').AggregatePlan }}
 */
export function buildAggregateQuery({ db, model, filter = {}, options = {}, fieldTypeRegistry, modelRegistry }, withOrder = true) {
  const plan = planAggregate(model, options, modelRegistry);
  const base = model.tableName;

  // ---- joins registered while expressions are built -------------------------------------------
  const toOneAliases = new Map(); // "customer.company" -> alias
  const toOneJoins = []; // in dependency order: a hop's parent is always registered before it
  const manySubqueries = new Map(); // relation name -> { alias, many, components }

  /** `alias.column` for a field reached through the to-one `hops` of the base model (none = the base table itself). */
  const columnRef = (hops, field) => {
    if (hops.length === 0) return `${base}.${model.columns[field]}`;
    let parent = base;
    let path = "";
    for (const hop of hops) {
      path += `${path ? "." : ""}${hop.name}`;
      let alias = toOneAliases.get(path);
      if (!alias) {
        alias = `agg_j${toOneAliases.size + 1}`;
        toOneAliases.set(path, alias);
        toOneJoins.push({
          alias,
          table: hop.to.tableName,
          target: `${alias}.${hop.to.columns[hop.targetField]}`,
          source: `${parent}.${hop.from.columns[hop.parentField]}`,
        });
      }
      parent = alias;
    }
    return `${parent}.${hops[hops.length - 1].to.columns[field]}`;
  };

  /** Registers (once) a subtotal column in the per-parent subquery for `entry`'s to-many relation; returns `alias.column`. */
  const subtotal = (entry, kind, sql, bindings) => {
    const { many } = entry;
    if (!manySubqueries.has(many.name)) {
      manySubqueries.set(many.name, { alias: `agg_m${manySubqueries.size + 1}`, many, components: [] });
    }
    const sub = manySubqueries.get(many.name);
    const name = `${kind}${entry.alias}`; // unique: aliases are unique across the result
    if (!sub.components.some((c) => c.name === name)) sub.components.push({ name, sql, bindings, entry });
    return `${sub.alias}.${name}`;
  };

  const memo = new Map();
  const expressionFor = (entry) => {
    if (!memo.has(entry)) memo.set(entry, buildExpression(entry));
    return memo.get(entry);
  };

  const buildExpression = (entry) => {
    if (entry.kind === "field") return { sql: "??", bindings: [columnRef(entry.hops, entry.field)] };
    if (entry.kind === "bucket") {
      return dateBucketSql(db, columnRef(entry.hops, entry.field), entry.bucket, { fieldType: entry.def.type });
    }

    if (entry.many) return manyExpression(entry);

    if (entry.field === null) return { sql: "count(*)", bindings: [] };
    const ref = columnRef(entry.hops, entry.field);
    if (entry.fn === "countDistinct") return { sql: "count(DISTINCT ??)", bindings: [ref] };
    return { sql: `${entry.fn}(??)`, bindings: [ref] };
  };

  /** The outer expression combining per-parent subtotals (see the module comment). */
  const manyExpression = (entry) => {
    const inner = innerRef(entry);
    switch (entry.fn) {
      case "count":
        return entry.field === null
          ? { sql: "COALESCE(SUM(??), 0)", bindings: [subtotal(entry, "n_", "count(*)", [])] }
          : { sql: "COALESCE(SUM(??), 0)", bindings: [subtotal(entry, "c_", "count(??)", [inner])] };
      case "sum":
        return { sql: "SUM(??)", bindings: [subtotal(entry, "s_", "sum(??)", [inner])] };
      case "avg":
        return {
          sql: "SUM(??) * 1.0 / NULLIF(SUM(??), 0)",
          bindings: [subtotal(entry, "s_", "sum(??)", [inner]), subtotal(entry, "c_", "count(??)", [inner])],
        };
      case "min":
        return { sql: "MIN(??)", bindings: [subtotal(entry, "m_", "min(??)", [inner])] };
      default:
        return { sql: "MAX(??)", bindings: [subtotal(entry, "x_", "max(??)", [inner])] };
    }
  };

  /** The column inside the per-parent subquery (child table `t`, then any to-one hops from it). */
  const innerRef = (entry) => {
    let parent = "t";
    for (const [i, hop] of entry.many.insideHops.entries()) parent = `t_${i + 1}`;
    return `${parent}.${(entry.many.insideHops.at(-1)?.to ?? entry.many.to).columns[entry.field]}`;
  };

  // Everything below needs every expression built first, so all joins are known.
  for (const entry of [...plan.keys, ...plan.aggregates]) expressionFor(entry);
  for (const { entry } of plan.order) expressionFor(entry);

  // ---- WHERE / HAVING ---------------------------------------------------------------------------
  let whereClause;
  let havingAst = null;
  if (Array.isArray(filter) || mentionsResultColumn(filter, plan)) {
    const split = splitFilter(model, filterToAst(filter), plan);
    whereClause = compileParsedDomain(model, split.where, fieldTypeRegistry, modelRegistry);
    havingAst = split.having;
  } else {
    whereClause = resolveWhere(model, filter, fieldTypeRegistry, modelRegistry);
  }

  // ---- assemble -----------------------------------------------------------------------------------
  const hasRelations = toOneJoins.length > 0 || manySubqueries.size > 0;
  let query = hasRelations
    ? db.from(db(base).where(whereClause).as(base)) // the filtered rows, named like the table so qualified refs resolve
    : db(base).where(whereClause);

  for (const join of toOneJoins) {
    query = query.leftJoin({ [join.alias]: join.table }, join.target, join.source);
  }
  for (const sub of manySubqueries.values()) {
    query = query.leftJoin(buildSubtotalQuery(db, sub).as(sub.alias), `${sub.alias}.k`, `${base}.${model.columns[sub.many.localField]}`);
  }

  for (const entry of [...plan.keys, ...plan.aggregates]) {
    const { sql, bindings } = expressionFor(entry);
    query = query.select(db.raw(`${sql} AS ??`, [...bindings, entry.alias]));
  }
  for (const key of plan.keys) {
    const { sql, bindings } = expressionFor(key);
    query = query.groupByRaw(sql, bindings);
  }
  if (havingAst) {
    const having = compileHaving(model, plan, havingAst, expressionFor, fieldTypeRegistry);
    query = query.havingRaw(having.sql, having.bindings);
  }

  if (withOrder) {
    // Nulls sort last in both directions on both databases (SQLite puts them first, Postgres last,
    // by default). Group keys that weren't ordered explicitly follow as tie-breakers, so the same
    // query always returns its groups in the same order - and `limit` is therefore meaningful.
    const ordered = new Set(plan.order.map(({ entry }) => entry));
    const order = [...plan.order, ...plan.keys.filter((key) => !ordered.has(key)).map((entry) => ({ entry, direction: "asc" }))];
    for (const { entry, direction } of order) {
      const { sql, bindings } = expressionFor(entry);
      query = query.orderByRaw(`(${sql}) IS NULL`, bindings).orderByRaw(`${sql} ${direction === "desc" ? "DESC" : "ASC"}`, bindings);
    }
    if (plan.limit !== undefined) query = query.limit(plan.limit);
    if (plan.offset !== undefined && plan.offset > 0) query = query.offset(plan.offset);
  }

  return { query, plan };
}

/** The per-parent subquery for one to-many relation: one row per parent key, one column per subtotal. */
function buildSubtotalQuery(db, { many, components }) {
  let sub;
  let keyColumn;
  if (many.kind === "belongsToMany") {
    sub = db({ pv: many.through }).join({ t: many.to.tableName }, `t.${many.to.columns[many.relatedKey]}`, `pv.${many.pivotOther}`);
    keyColumn = `pv.${many.pivotKey}`;
  } else {
    sub = db({ t: many.to.tableName });
    keyColumn = `t.${many.to.columns[many.childField]}`;
  }

  let parent = "t";
  for (const [i, hop] of many.insideHops.entries()) {
    const alias = `t_${i + 1}`;
    sub = sub.leftJoin({ [alias]: hop.to.tableName }, `${alias}.${hop.to.columns[hop.targetField]}`, `${parent}.${hop.from.columns[hop.parentField]}`);
    parent = alias;
  }

  sub = sub.select(db.raw("?? AS ??", [keyColumn, "k"]));
  for (const { name, sql, bindings } of components) sub = sub.select(db.raw(`${sql} AS ??`, [...bindings, name]));
  return sub.groupBy(keyColumn);
}

/** Runs the query. @returns {Promise<Array<Record<string, unknown>>>} */
export async function runAggregate(ctx) {
  const { query, plan } = buildAggregateQuery(ctx);
  const rows = await query;
  return rows.map((row) => mapRow(plan, row, ctx.fieldTypeRegistry));
}

/**
 * How many groups the aggregate would return, ignoring orderBy/limit/offset: one statement,
 * counting the grouped query as a derived table.
 * @returns {Promise<number>}
 */
export async function countAggregateGroups(ctx) {
  const { query } = buildAggregateQuery(ctx, false);
  const [row] = await ctx.db.count({ n: "*" }).from(query.as("agg_groups"));
  return Number(row.n);
}

const toNumber = (value) => (value === null || value === undefined ? null : Number(value));

/**
 * Turns a raw row into a result row, making both databases agree. Postgres returns
 * count/sum/avg as strings (bigint, numeric) and SQLite as numbers; here they are all
 * numbers (a sum or average of no rows is null, a count of no rows is 0). min/max come back
 * as the column's own type (a Date for a date field). Group keys are cast like any stored value.
 * Numbers are JS doubles: a count or integer sum beyond 2^53 would lose precision.
 */
function mapRow(plan, row, fieldTypeRegistry) {
  const result = {};
  for (const key of plan.keys) {
    const value = row[key.alias];
    if (key.kind === "bucket") result[key.alias] = parseBucket(value);
    else result[key.alias] = value === null || value === undefined ? null : castValue(key.def, value, fieldTypeRegistry);
  }
  for (const aggregate of plan.aggregates) {
    const value = row[aggregate.alias];
    switch (aggregate.fn) {
      case "count":
      case "countDistinct":
        result[aggregate.alias] = toNumber(value) ?? 0;
        break;
      case "sum":
      case "avg":
        result[aggregate.alias] = toNumber(value);
        break;
      default: // min, max
        result[aggregate.alias] = value === null || value === undefined ? null : castValue(aggregate.def, value, fieldTypeRegistry);
    }
  }
  return result;
}
