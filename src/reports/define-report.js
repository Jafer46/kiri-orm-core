import { ReportDefinitionError } from "./errors.js";

/**
 * A report is a read-only, transient model: a named query that returns summary rows
 * rather than records. It has no table, is never synced, migrated or recorded in the meta
 * tables, and its rows are plain objects - nothing is tracked or saveable.
 *
 * ```js
 * defineReport("salesByCustomer", {
 *   from: "order",                                       // the model it reads
 *   where: [["status", "!=", "cancelled"]],              // always applied
 *   fields: {
 *     customerId:   true,                                // a plain field of `order`        -> a group key
 *     customerName: "customer.name",                     // a field through a to-one path   -> a group key
 *     month:        { from: "placedAt", bucket: "month" },
 *     orders:       { agg: "count" },                    // aggregates ...
 *     revenue:      { agg: "sum", of: "total" },
 *     units:        { agg: "sum", of: "items.qty" },     // ... including across a to-many relation
 *     avgItem:      { agg: "avg", of: "items.amount" },
 *     margin:       { compute: (row) => row.revenue - row.cost, depends: ["revenue", "cost"] },
 *   },
 *   orderBy: "-revenue",                                 // default; can be overridden per call
 * });
 * ```
 *
 * The rule that keeps this unambiguous: **every field that isn't an aggregate or a computed
 * field is a group key**, so together they are the report's grain (one row per customer, per month).
 * There is no separate `groupBy` to keep in step with the fields. A field like `customerName` next to
 * `customerId` doesn't change the grain, since a customer has one name.
 *
 * Computed fields are plain JavaScript over the finished row (`depends` names the report fields they
 * read, which must be declared before them). They are applied after the query, so they cost nothing
 * extra, and can't be filtered or sorted by - the database never sees them.
 *
 * Only the shape is checked here. Whether `from`, the paths and the types match the registered
 * models is checked on first use (see ReportHandle), because models may be defined after the report.
 *
 * @typedef {{ kind: "key", from: string, bucket?: string }
 *   | { kind: "aggregate", agg: string, of: string|null }
 *   | { kind: "computed", compute: Function, depends: string[] }} ReportField
 * @typedef {{ name: string, from: string, where: unknown, orderBy: unknown,
 *   fields: Readonly<Record<string, ReportField>> }} ReportDescriptor
 */

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const AGGREGATES = ["count", "countDistinct", "sum", "avg", "min", "max"];
const REPORT_KEYS = new Set(["from", "where", "fields", "orderBy"]);
const KEY_KEYS = new Set(["from", "bucket"]);
const AGG_KEYS = new Set(["agg", "of"]);
const COMPUTED_KEYS = new Set(["compute", "depends"]);

/**
 * @param {string} name
 * @param {object} definition
 * @returns {Readonly<ReportDescriptor>}
 * @throws {ReportDefinitionError}
 */
export function defineReport(name, definition) {
  if (typeof name !== "string" || !IDENTIFIER.test(name)) {
    throw new ReportDefinitionError(String(name), "the report name must be a plain identifier");
  }
  const fail = (message) => {
    throw new ReportDefinitionError(name, message);
  };
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) fail("expected a definition object");

  for (const key of Object.keys(definition)) {
    if (!REPORT_KEYS.has(key)) fail(`unknown option "${key}". Valid: ${[...REPORT_KEYS].join(", ")}`);
  }
  if (typeof definition.from !== "string" || definition.from === "") fail("`from` must name the model the report reads");
  if (!definition.fields || typeof definition.fields !== "object" || Array.isArray(definition.fields) || Object.keys(definition.fields).length === 0) {
    fail("`fields` must be an object with at least one field");
  }

  const fields = {};
  for (const [fieldName, spec] of Object.entries(definition.fields)) {
    if (!IDENTIFIER.test(fieldName)) fail(`field name ${JSON.stringify(fieldName)} must be a plain identifier`);
    fields[fieldName] = Object.freeze(normalizeField(fieldName, spec, fields, fail));
  }
  if (!Object.values(fields).some((f) => f.kind !== "computed")) fail("a report needs at least one key or aggregate field, not only computed ones");

  return Object.freeze({
    name,
    from: definition.from,
    where: definition.where ?? [],
    orderBy: definition.orderBy,
    fields: Object.freeze(fields),
  });
}

function normalizeField(fieldName, spec, declaredSoFar, fail) {
  const where = `field "${fieldName}"`;
  const onlyKeys = (allowed) => {
    for (const key of Object.keys(spec)) {
      if (!allowed.has(key)) fail(`${where}: unknown option "${key}". Valid here: ${[...allowed].join(", ")}`);
    }
  };

  if (spec === true) return { kind: "key", from: fieldName };
  if (typeof spec === "string") return { kind: "key", from: spec };
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    fail(`${where}: expected true, a field path, or an object (got ${JSON.stringify(spec)})`);
  }

  if ("agg" in spec) {
    onlyKeys(AGG_KEYS);
    if (!AGGREGATES.includes(spec.agg)) fail(`${where}: unknown aggregate ${JSON.stringify(spec.agg)}. Use one of ${AGGREGATES.join(", ")}`);
    if (spec.of === undefined && spec.agg !== "count") fail(`${where}: "${spec.agg}" needs \`of\` - the field to ${spec.agg}`);
    if (spec.of !== undefined && (typeof spec.of !== "string" || spec.of === "")) fail(`${where}: \`of\` must be a field path`);
    return { kind: "aggregate", agg: spec.agg, of: spec.of ?? null };
  }

  if ("compute" in spec) {
    onlyKeys(COMPUTED_KEYS);
    if (typeof spec.compute !== "function") fail(`${where}: \`compute\` must be a function`);
    const depends = spec.depends ?? [];
    if (!Array.isArray(depends) || depends.some((d) => typeof d !== "string")) fail(`${where}: \`depends\` must be an array of field names`);
    for (const dependency of depends) {
      if (!(dependency in declaredSoFar)) {
        fail(`${where}: depends on "${dependency}", which isn't a field declared before it. Declare computed fields after the fields they read.`);
      }
    }
    return { kind: "computed", compute: spec.compute, depends: [...depends] };
  }

  onlyKeys(KEY_KEYS);
  if (spec.from !== undefined && (typeof spec.from !== "string" || spec.from === "")) fail(`${where}: \`from\` must be a field path`);
  return { kind: "key", from: spec.from ?? fieldName, ...(spec.bucket === undefined ? {} : { bucket: spec.bucket }) };
}

/**
 * The options aggregate() needs to run a report's fields: keys become `groupBy` entries named after
 * the report field, aggregates become `aggregates`.
 * @param {ReportDescriptor} descriptor
 * @returns {{ groupBy: object[], aggregates: Record<string, unknown> }}
 */
export function toAggregateOptions(descriptor) {
  const groupBy = [];
  const aggregates = {};
  for (const [name, field] of Object.entries(descriptor.fields)) {
    if (field.kind === "key") {
      groupBy.push({ field: field.from, as: name, ...(field.bucket === undefined ? {} : { bucket: field.bucket }) });
    } else if (field.kind === "aggregate") {
      aggregates[name] = field.of === null ? "count" : { [field.agg]: field.of };
    }
  }
  return { groupBy, aggregates };
}
