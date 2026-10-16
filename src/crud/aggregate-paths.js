import { primaryKeyOf } from "../models/primary-key.js";
import { resolveLocalKey } from "../relations/keys.js";

/**
 * Resolves a dotted path such as `customer.company.country` or `items.product.price`, starting
 * at an aggregate's base model, into the pieces the SQL builder needs.
 *
 * The one distinction that matters is whether a relation can multiply rows:
 *
 * - **to-one** (`belongsTo` onto the related model's primary key): each row has at most one
 *   match, so a plain LEFT JOIN leaves the row count alone. These can be grouped by and
 *   aggregated freely, to any depth.
 * - **to-many** (`hasMany`, `hasOne`, `belongsToMany`): joining would repeat the row once per
 *   match, and `sum(order.total)` over that join counts every order once per item. These are
 *   aggregated in their own subquery, one row per parent, and joined on the parent's key (see
 *   aggregate.js). They can be aggregated but never grouped by - grouping by a to-many field
 *   isn't "one group per parent", it's a different grain.
 *
 * `hasOne` is treated as to-many on purpose: nothing stops a database holding two rows for one
 * parent, and a join would then silently double-count. (The eager loader quietly takes the first.)
 *
 * Supported shape: any number of to-one hops, OR one to-many relation first (followed by any to-one
 * hops inside it): `customer.company.country`, `items.amount`, `items.product.price`. A to-many
 * after a to-one hop (`customer.orders.total`) isn't supported yet, nor are two to-many relations.
 *
 * @typedef {{ name: string, relation: object, from: object, to: object, parentField: string, targetField: string }} ToOneHop
 * @typedef {{ name: string, relation: object, kind: string, from: object, to: object, localField: string,
 *   childField?: string, through?: string, pivotKey?: string, pivotOther?: string, relatedKey?: string,
 *   insideHops: ToOneHop[] }} ToManyPath
 * @typedef {{ hops: ToOneHop[], many: ToManyPath|null, model: object, field: string|null, def: object|null }} ResolvedPath
 */

/**
 * @param {object} model - the base model
 * @param {import('../models/registry.js').ModelRegistry|undefined} modelRegistry
 * @param {string} path
 * @param {object} options
 * @param {(message: string) => never} options.fail
 * @param {string} options.context - e.g. `groupBy "customer.country"`, prefixed to every message
 * @param {boolean} [options.allowMany] - a to-many relation may appear (aggregates yes, group keys no)
 * @param {boolean} [options.allowRelationEnd] - the path may end at a relation (only `count` does)
 * @returns {ResolvedPath}
 */
export function resolvePath(model, modelRegistry, path, { fail, context, allowMany = false, allowRelationEnd = false }) {
  const segments = String(path).split(".");
  if (segments.some((segment) => segment === "")) fail(`${context}: "${path}" is not a valid path`);

  let current = model;
  const hops = [];
  let many = null;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const last = i === segments.length - 1;

    if (Object.prototype.hasOwnProperty.call(current.fields, segment)) {
      if (!last) fail(`${context}: "${segment}" is a field of "${current.name}", not a relation, so "${segments.slice(i + 1).join(".")}" can't follow it`);
      return { hops, many, model: current, field: segment, def: current.fields[segment] };
    }

    if (current.computed && Object.prototype.hasOwnProperty.call(current.computed, segment)) {
      fail(
        `${context}: "${segment}" is a computed field of "${current.name}" - calculated in JavaScript, so the database can't group or ` +
          `aggregate by it. Use the stored fields it depends on (${current.computed[segment].depends.join(", ") || "none"}).`
      );
    }

    const relation = current.relations?.[segment];
    if (!relation) {
      const relations = Object.keys(current.relations ?? {});
      fail(
        `${context}: unknown field "${segment}" on model "${current.name}". ` +
          `Fields: ${Object.keys(current.fields).join(", ")}${relations.length ? `. Relations: ${relations.join(", ")}` : ""}`
      );
    }

    if (!modelRegistry) {
      if (last && !allowRelationEnd) {
        fail(`${context}: "${segment}" is a relation, not a field. Name one of the fields of "${relation.model}" after it, e.g. "${path}.<field>".`);
      }
      fail(`${context}: following the relation "${segment}" needs a model registry (construct the Repository with one, or use client / createModel)`);
    }
    const related = modelRegistry.getModel(relation.model); // throws UnknownModelError if the target isn't defined
    const toMany = relation.type !== "belongsTo";

    if (toMany) {
      if (many) {
        fail(`${context}: more than one to-many relation in a path ("${many.name}" and "${segment}") isn't supported. Aggregate one at a time.`);
      }
      if (!allowMany) {
        fail(
          `${context}: "${segment}" is a ${relation.type} (to-many) relation, so it can't be grouped by - each ${current.name} would ` +
            `appear once per related row, and its own totals would repeat. Aggregate it instead (e.g. { sum: "${segments.join(".")}" }), ` +
            `or start from "${related.name}" and group by its fields.`
        );
      }
      if (hops.length > 0) {
        fail(
          `${context}: a to-many relation ("${segment}") after a to-one hop ("${hops.map((h) => h.name).join(".")}") isn't supported yet. ` +
            `Aggregate from "${current.name}" instead.`
        );
      }
      many = toManyPath(relation, segment, current, related, context, fail);
    } else {
      const hop = toOneHop(relation, segment, current, related, context, fail);
      (many ? many.insideHops : hops).push(hop);
    }

    current = related;
    if (last) {
      if (!allowRelationEnd) {
        fail(`${context}: "${segment}" is a relation, not a field. Name one of the fields of "${related.name}" after it (${Object.keys(related.fields).join(", ")}).`);
      }
      // `count: "items"` counts related rows; `count: "customer"` counts the rows that have one.
      return { hops, many, model: related, field: many ? null : primaryKeyOf(related), def: many ? null : related.fields[primaryKeyOf(related)] };
    }
  }
  /* c8 ignore next */
  throw new Error("unreachable");
}

function toOneHop(relation, name, from, to, context, fail) {
  const targetField = resolveLocalKey(relation, from, to);
  if (targetField !== primaryKeyOf(to)) {
    fail(
      `${context}: "${name}" points at "${to.name}.${targetField}", which isn't its primary key, so it isn't guaranteed to match one row. ` +
        `Only relations onto a primary key can be followed in an aggregate.`
    );
  }
  return { name, relation, from, to, parentField: relation.foreignKey, targetField };
}

function toManyPath(relation, name, from, to, context, fail) {
  const localField = resolveLocalKey(relation, from, to);
  if (localField !== primaryKeyOf(from)) {
    fail(
      `${context}: "${name}" is matched on "${from.name}.${localField}", which isn't the primary key, so a parent row could repeat. ` +
        `Only relations matched on the primary key can be aggregated.`
    );
  }
  const base = { name, relation, kind: relation.type, from, to, localField, insideHops: [] };
  if (relation.type === "belongsToMany") {
    return { ...base, through: relation.through, pivotKey: relation.foreignKey, pivotOther: relation.otherKey, relatedKey: primaryKeyOf(to) };
  }
  return { ...base, childField: relation.foreignKey };
}
