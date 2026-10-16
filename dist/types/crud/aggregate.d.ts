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
export declare function buildAggregateQuery({ db, model, filter, options, fieldTypeRegistry, modelRegistry }: {
    db: import('knex').Knex;
    model: import('../models/define-model.js').ModelDescriptor;
    filter: Record<string, unknown> | unknown[];
    options: object;
    fieldTypeRegistry: import('../fields/registry.js').FieldTypeRegistry;
    modelRegistry?: import('../models/registry.js').ModelRegistry;
}, withOrder?: boolean): {
    query: import('knex').Knex.QueryBuilder;
    plan: import('./aggregate-spec.js').AggregatePlan;
};
/** Runs the query. @returns {Promise<Array<Record<string, unknown>>>} */
export declare function runAggregate(ctx: any): Promise<Array<Record<string, unknown>>>;
/**
 * How many groups the aggregate would return, ignoring orderBy/limit/offset: one statement,
 * counting the grouped query as a derived table.
 * @returns {Promise<number>}
 */
export declare function countAggregateGroups(ctx: any): Promise<number>;
