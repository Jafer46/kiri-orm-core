import { ValidationError } from "./errors.js";
import { DATE_BUCKETS } from "../dialect/date-bucket.js";
import { parseOrderBy, validatePaging } from "./order.js";
import { resolvePath } from "./aggregate-paths.js";

/**
 * Parses and validates the options of `aggregate()` into a plan the SQL builder can follow
 * without further checking. Everything user-supplied is rejected here, before a query is built.
 *
 *   {
 *     groupBy: ["status", "createdAt:month", { field: "createdAt", bucket: "week", as: "week" }],
 *     aggregates: { orders: "count", revenue: { sum: "total" }, biggest: { max: "total" } },
 *     orderBy: "-revenue",
 *     limit: 10,
 *   }
 *
 * The plan has three parts:
 * - `keys`: what the rows are grouped by - a stored field of the model or of a model reached through
 *   to-one relations (`customer.country`), as itself or as a date bucket;
 * - `aggregates`: the computed columns (count, countDistinct, sum, avg, min, max) over a field of the
 *   model, of a to-one relation, or of a to-many relation (`items.amount`) - see aggregate-paths.js;
 * - `order`: what to sort by, each entry pointing at one of the above.
 *
 * Every entry also carries what the SQL builder needs about where its value comes from: `fieldPath`
 * (the path as written), `hops` (to-one relations to join), `many` (a to-many relation to pre-aggregate,
 * aggregates only) and `def` (the final field's definition, for casting and type checks).
 *
 * @typedef {{ alias: string, kind: "field"|"bucket", field: string, fieldPath: string, bucket?: string,
 *   hops: object[], def: object }} GroupKey
 * @typedef {{ alias: string, fn: "count"|"countDistinct"|"sum"|"avg"|"min"|"max", field: string|null, fieldPath: string|null,
 *   hops: object[], many: object|null, def: object|null }} AggregateColumn
 * @typedef {{ keys: GroupKey[], aggregates: AggregateColumn[], order: Array<{ entry: GroupKey|AggregateColumn, direction: "asc"|"desc" }>,
 *   limit?: number, offset?: number }} AggregatePlan
 */

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const FUNCTIONS = ["count", "countDistinct", "sum", "avg", "min", "max"];
const NUMERIC_TYPES = new Set(["integer", "float"]);
const COMPARABLE_TYPES = new Set(["integer", "float", "date", "datetime", "char", "text", "enum"]); // min / max
const DATE_TYPES = new Set(["date", "datetime"]);
const GROUP_OPTION_KEYS = new Set(["field", "bucket", "as"]);

/**
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {object} options - the options object given to aggregate()
 * @param {import('../models/registry.js').ModelRegistry} [modelRegistry] - needed to follow relations
 * @returns {AggregatePlan}
 * @throws {ValidationError} keyed by the option at fault: `groupBy`, `aggregates` or `orderBy`
 */
export function planAggregate(model, options = {}, modelRegistry = undefined) {
  const failIn = (option) => (message) => {
    throw new ValidationError(model.name, { [option]: [message] });
  };

  const taken = new Set(); // every output name, so two columns can't share one
  const keys = parseGroupBy(model, modelRegistry, options.groupBy, failIn("groupBy"), taken);
  const aggregates = parseAggregates(model, modelRegistry, options.aggregates, failIn("aggregates"), taken);

  if (keys.length === 0 && aggregates.length === 0) {
    failIn("aggregates")("nothing to compute: pass `aggregates` (e.g. { total: \"count\" }) and/or `groupBy`");
  }

  validatePaging(model, { limit: options.limit, offset: options.offset });

  const byAlias = new Map([...keys, ...aggregates].map((entry) => [entry.alias, entry]));
  let order;
  if (options.orderBy === undefined || options.orderBy === null) {
    order = keys.map((entry) => ({ entry, direction: "asc" })); // a grouped result has no inherent order; make it stable
  } else {
    const fail = failIn("orderBy");
    order = parseOrderBy(options.orderBy, fail).map(({ field, direction }) => {
      const entry = byAlias.get(field);
      if (!entry) {
        fail(`orderBy: "${field}" is not a column of this result. Sortable: ${[...byAlias.keys()].join(", ") || "(none)"}`);
      }
      return { entry, direction };
    });
  }

  return { keys, aggregates, order, limit: options.limit, offset: options.offset };
}

/**
 * An output name must be a plain identifier, unused, and not shadow a field (filters read those names).
 * The one exception is a plain group key named exactly like the field it groups by (`selfField`).
 */
function claimAlias(model, alias, fail, taken, { what, selfField = null }) {
  if (typeof alias !== "string" || !IDENTIFIER.test(alias)) {
    fail(`${what} name ${JSON.stringify(alias)} must be a plain identifier (letters, digits, underscore; not starting with a digit)`);
  }
  const shadows =
    (alias !== selfField && Object.prototype.hasOwnProperty.call(model.fields, alias)) ||
    Object.prototype.hasOwnProperty.call(model.computed ?? {}, alias) ||
    Object.prototype.hasOwnProperty.call(model.relations ?? {}, alias);
  if (shadows) {
    fail(
      `${what} name "${alias}" is already a field, computed field or relation of model "${model.name}", ` +
        `so a filter could not tell them apart. Pick another name.`
    );
  }
  if (taken.has(alias)) fail(`the result column "${alias}" is defined more than once`);
  taken.add(alias);
}

const aliasFromPath = (path) => path.replace(/\./g, "_");

function parseGroupBy(model, modelRegistry, input, fail, taken) {
  if (input === undefined || input === null) return [];
  const items = Array.isArray(input) ? input : [input];
  const keys = [];

  for (const item of items) {
    let path;
    let bucket;
    let as;

    if (typeof item === "string") {
      const parts = item.split(":");
      if (parts.length > 2) fail(`groupBy entry ${JSON.stringify(item)} has more than one ":"`);
      [path, bucket] = parts;
      if (bucket === "") fail(`groupBy entry ${JSON.stringify(item)} is missing the bucket after ":"`);
    } else if (item && typeof item === "object" && !Array.isArray(item)) {
      for (const key of Object.keys(item)) {
        if (!GROUP_OPTION_KEYS.has(key)) fail(`unknown groupBy option "${key}". Valid: ${[...GROUP_OPTION_KEYS].join(", ")}`);
      }
      ({ field: path, bucket, as } = item);
    } else {
      fail(`groupBy entries must be a field name, "field:bucket" or { field, bucket, as } (got ${JSON.stringify(item)})`);
    }
    if (typeof path !== "string" || path === "") fail(`groupBy "${path}": expected a field name, got ${JSON.stringify(path)}`);

    const resolved = resolvePath(model, modelRegistry, path, { fail, context: `groupBy "${path}"` });
    const { def, hops } = resolved;
    if (def.type === "json") fail(`groupBy "${path}": json fields can't be grouped by`);

    const base = { fieldPath: path, field: resolved.field, hops, def };

    if (bucket === undefined) {
      const alias = as ?? (hops.length === 0 ? path : aliasFromPath(path));
      claimAlias(model, alias, fail, taken, { what: "groupBy", selfField: hops.length === 0 ? path : null });
      keys.push({ alias, kind: "field", ...base });
      continue;
    }

    if (!DATE_TYPES.has(def.type)) {
      fail(`groupBy "${path}": a bucket needs a date or datetime field, but "${path}" is ${def.type}`);
    }
    if (!DATE_BUCKETS.includes(bucket)) {
      fail(`groupBy "${path}": unknown bucket ${JSON.stringify(bucket)}. Buckets: ${DATE_BUCKETS.join(", ")}`);
    }
    const alias = as ?? `${aliasFromPath(path)}_${bucket}`;
    claimAlias(model, alias, fail, taken, { what: "groupBy" });
    keys.push({ alias, kind: "bucket", bucket, ...base });
  }
  return keys;
}

function parseAggregates(model, modelRegistry, input, fail, taken) {
  if (input === undefined || input === null) return [];
  if (typeof input !== "object" || Array.isArray(input)) {
    fail('`aggregates` must be an object of { name: spec }, e.g. { orders: "count", revenue: { sum: "total" } }');
  }

  const columns = [];
  for (const [alias, spec] of Object.entries(input)) {
    claimAlias(model, alias, fail, taken, { what: "aggregate" });
    columns.push(parseOneAggregate(model, modelRegistry, alias, spec, fail));
  }
  return columns;
}

function parseOneAggregate(model, modelRegistry, alias, spec, fail) {
  const where = `aggregate "${alias}"`;
  const rows = { alias, fn: "count", field: null, fieldPath: null, hops: [], many: null, def: null };
  if (spec === "count") return rows;

  if (typeof spec === "string") {
    fail(`${where}: ${JSON.stringify(spec)} needs a field. Write { ${FUNCTIONS.includes(spec) ? spec : "sum"}: "fieldName" } ("count" alone counts rows)`);
  }
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    fail(`${where}: expected "count" or { fn: field } with fn one of ${FUNCTIONS.join(", ")} (got ${JSON.stringify(spec)})`);
  }
  const names = Object.keys(spec);
  if (names.length !== 1 || !FUNCTIONS.includes(names[0])) {
    fail(`${where}: expected exactly one of ${FUNCTIONS.join(", ")}, got ${JSON.stringify(names)}`);
  }

  const fn = names[0];
  const target = spec[fn];

  if (fn === "count" && (target === "*" || target === true)) return rows;
  if (typeof target !== "string" || target === "") {
    fail(`${where} (${fn}): expected a field name, got ${JSON.stringify(target)}`);
  }

  // Only `count` may name a relation itself ("count: items" = how many related rows).
  const resolved = resolvePath(model, modelRegistry, target, {
    fail, context: `${where} (${fn})`, allowMany: true, allowRelationEnd: fn === "count",
  });
  const { def, many } = resolved;

  if (def) {
    if ((fn === "sum" || fn === "avg") && !NUMERIC_TYPES.has(def.type)) {
      fail(`${where}: ${fn} needs an integer or float field, but "${target}" is ${def.type}`);
    }
    if ((fn === "min" || fn === "max") && !COMPARABLE_TYPES.has(def.type)) {
      fail(`${where}: ${fn} needs a number, date, or text field, but "${target}" is ${def.type}`);
    }
    if (fn === "countDistinct" && def.type === "json") {
      fail(`${where}: countDistinct can't compare json values`);
    }
  }
  if (many && fn === "countDistinct") {
    fail(
      `${where}: countDistinct across the to-many relation "${many.name}" isn't supported - the same value can appear under several ` +
        `${model.name} rows, and counting it once overall can't be assembled from per-row subtotals. Use count, or aggregate from "${many.to.name}" instead.`
    );
  }

  return { alias, fn, field: resolved.field, fieldPath: target, hops: resolved.hops, many, def };
}
