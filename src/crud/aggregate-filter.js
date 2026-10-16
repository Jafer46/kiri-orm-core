import { parseDomain } from "../domain/parse.js";
import { castValue } from "../fields/cast-value.js";
import { ValidationError } from "./errors.js";

/**
 * WHERE vs HAVING.
 *
 * One `filter` is given to aggregate(), written like any other filter, and may mention both
 * ordinary fields ("only paid orders") and the result's aggregates ("with revenue over
 * 1000"). SQL needs those in two places: a condition on a row's own values goes in WHERE and
 * runs BEFORE grouping; a condition on an aggregate can only exist AFTER grouping, in HAVING.
 * Nobody should have to remember that, so this module sorts them:
 *
 *   [["status", "=", "paid"], ["revenue", ">", 1000]]
 *        -> WHERE status = 'paid'   HAVING sum(total) > 1000
 *
 * The filter is a list of conditions ANDed together, and each AND-ed condition is sorted on
 * its own. A condition that mixes the two *inside* an OR or a NOT can't be split without
 * changing what it means - `status = 'paid' OR revenue > 1000` needs the aggregate, which only
 * exists per group, so no row-level test can stand in for the first half - so that is
 * rejected with an explanation instead of guessed at.
 *
 * Conditions on a plain group-by field go to WHERE: the field is the same for every row in
 * a group, so filtering rows first and filtering groups after select identical groups, and
 * WHERE is cheaper (fewer rows to group). Conditions on a relation path (`customer.country`)
 * go to WHERE too, as the usual subquery. A group key that was renamed (`as: "country"` over
 * `customer.country`) can be filtered by its new name: the condition is rewritten to the path it stands for.
 */

const HAVING_OPERATORS = new Set(["=", "!=", ">", ">=", "<", "<=", "in", "not in"]);

/**
 * Turns the filter into an AST (a plain-object filter becomes `[field = value]` terms).
 * @param {Record<string, unknown>|unknown[]|undefined|null} filter
 */
export function filterToAst(filter) {
  if (Array.isArray(filter)) return parseDomain(filter);
  return parseDomain(Object.entries(filter ?? {}).map(([field, value]) => [field, "=", value]));
}

/** The result columns a filter must not treat as ordinary model fields: aggregates, buckets, and renamed keys. */
const renamedKeys = (plan) => plan.keys.filter((key) => key.kind === "field" && key.alias !== key.fieldPath);

/** True if a plain-object filter names one of the result's own columns (so it can't be a simple column filter). */
export function mentionsResultColumn(filter, plan) {
  if (Array.isArray(filter) || !filter) return false;
  const names = new Set([...plan.aggregates, ...plan.keys.filter((k) => k.kind === "bucket"), ...renamedKeys(plan)].map((entry) => entry.alias));
  return Object.keys(filter).some((key) => names.has(key));
}

/**
 * Splits a filter AST into the part for WHERE and the part for HAVING.
 *
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {import('../domain/parse.js').DomainNode} ast
 * @param {import('./aggregate-spec.js').AggregatePlan} plan
 * @returns {{ where: import('../domain/parse.js').DomainNode, having: import('../domain/parse.js').DomainNode|null }}
 */
export function splitFilter(model, ast, plan) {
  const aggregateAliases = new Set(plan.aggregates.map((a) => a.alias));
  const bucketAliases = new Set(plan.keys.filter((k) => k.kind === "bucket").map((k) => k.alias));
  const fail = (message) => {
    throw new ValidationError(model.name, { filter: [message] });
  };

  // "row" or "aggregate" for every leaf under `node`
  const kindsOf = (node, found = new Set()) => {
    if (node.type === "leaf") {
      if (bucketAliases.has(node.field)) {
        const key = plan.keys.find((k) => k.alias === node.field);
        fail(
          `"${node.field}" is a ${key.bucket} bucket of "${key.field}", not a column you can filter on. ` +
            `Filter the field itself in the same filter instead, e.g. ["${key.field}", ">=", someDate].`
        );
      }
      found.add(aggregateAliases.has(node.field) ? "aggregate" : "row");
    } else {
      node.children.forEach((child) => kindsOf(child, found));
    }
    return found;
  };

  const conjuncts = [];
  const flatten = (node) => (node.type === "and" ? node.children.forEach(flatten) : conjuncts.push(node));
  flatten(ast);

  // A renamed key stands for a model field or a path; a row condition on it is a condition on that.
  const pathOf = new Map(renamedKeys(plan).map((key) => [key.alias, key.fieldPath]));
  const unalias = (node) =>
    node.type === "leaf"
      ? pathOf.has(node.field) ? { ...node, field: pathOf.get(node.field) } : node
      : { ...node, children: node.children.map(unalias) };

  const where = [];
  const having = [];
  for (const node of conjuncts) {
    const kinds = kindsOf(node);
    if (kinds.size === 2) {
      fail(
        `a ${node.type === "not" ? "'!'" : "'|'"} condition mixes fields of the rows with aggregates (${[...aggregateAliases].join(", ")}). ` +
          `Rows are filtered before grouping and aggregates after, so the two halves can't be tested together. ` +
          `Put each in its own AND-ed condition, or split this into two queries.`
      );
    }
    (kinds.has("aggregate") ? having : where).push(kinds.has("aggregate") ? node : unalias(node));
  }

  return {
    where: { type: "and", children: where },
    having: having.length === 0 ? null : { type: "and", children: having },
  };
}

/**
 * Compiles the HAVING half to one SQL string plus its bindings.
 *
 * @param {import('./aggregate-spec.js').AggregatePlan} plan
 * @param {import('../domain/parse.js').DomainNode} ast
 * @param {(entry: object) => { sql: string, bindings: unknown[] }} expressionFor - the aggregate's SQL expression
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {import('../fields/registry.js').FieldTypeRegistry} fieldTypeRegistry
 * @returns {{ sql: string, bindings: unknown[] }}
 */
export function compileHaving(model, plan, ast, expressionFor, fieldTypeRegistry) {
  const fail = (message) => {
    throw new ValidationError(model.name, { filter: [message] });
  };
  const byAlias = new Map(plan.aggregates.map((a) => [a.alias, a]));

  // count/sum/avg come out as numbers whatever the column was; min/max keep the column's own type.
  const castFor = (aggregate) => {
    const field = aggregate.fn === "min" || aggregate.fn === "max" ? aggregate.def : { type: "float" };
    return (value, op) => {
      try {
        return castValue(field, value, fieldTypeRegistry);
      } catch (error) {
        return fail(`filter on aggregate "${aggregate.alias}" (${op}): ${error.message}`);
      }
    };
  };

  const compile = (node) => {
    if (node.type === "and" || node.type === "or") {
      if (node.children.length === 0) return { sql: "1 = 1", bindings: [] };
      const parts = node.children.map(compile);
      const glue = node.type === "and" ? " AND " : " OR ";
      return { sql: `(${parts.map((p) => p.sql).join(glue)})`, bindings: parts.flatMap((p) => p.bindings) };
    }
    if (node.type === "not") {
      const inner = compile(node.children[0]);
      return { sql: `NOT (${inner.sql})`, bindings: inner.bindings };
    }

    const aggregate = byAlias.get(node.field);
    const { op, value } = node;
    if (!HAVING_OPERATORS.has(op)) {
      fail(`filter on aggregate "${node.field}": operator "${op}" isn't supported on aggregates. Use one of: ${[...HAVING_OPERATORS].join(", ")}`);
    }
    const expression = expressionFor(aggregate);
    const cast = castFor(aggregate);

    if (op === "in" || op === "not in") {
      if (!Array.isArray(value)) fail(`filter on aggregate "${node.field}": "${op}" needs an array`);
      if (value.length === 0) return { sql: op === "in" ? "1 = 0" : "1 = 1", bindings: [] };
      const values = value.map((v) => cast(v, op));
      return {
        sql: `${expression.sql} ${op === "in" ? "IN" : "NOT IN"} (${values.map(() => "?").join(", ")})`,
        bindings: [...expression.bindings, ...values],
      };
    }
    if (value === null) {
      if (op !== "=" && op !== "!=") fail(`filter on aggregate "${node.field}": can't compare to null with "${op}"`);
      return { sql: `${expression.sql} IS ${op === "=" ? "" : "NOT "}NULL`, bindings: expression.bindings };
    }
    return { sql: `${expression.sql} ${op === "!=" ? "<>" : op} ?`, bindings: [...expression.bindings, cast(value, op)] };
  };

  return compile(ast);
}
