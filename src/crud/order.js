import { ValidationError } from "./errors.js";
import { primaryKeyOf } from "../models/primary-key.js";

const DIRECTIONS = new Set(["asc", "desc"]);

/**
 * Normalizes `orderBy` into `[{ field, direction }]`, validating field names.
 *
 * Accepted forms (all interchangeable):
 *   "title"                          ascending
 *   "-title"                         descending (leading minus)
 *   ["title", "-createdAt"]          several keys, in priority order
 *   [["title", "desc"]]              [field, direction] pairs
 *   { field: "title", direction: "desc" }   (also inside an array)
 *
 * Only stored fields can be ordered by - computed fields have no column.
 *
 * @param {object} model
 * @param {unknown} orderBy
 * @returns {Array<{ field: string, direction: "asc"|"desc" }>}
 */
export function normalizeOrderBy(model, orderBy) {
  const entries = parseOrderBy(orderBy, (message) => fail(model, message));
  for (const { field } of entries) {
    if (!Object.prototype.hasOwnProperty.call(model.fields, field)) {
      const known = Object.keys(model.fields).join(", ");
      const computedHint =
        model.computed && Object.prototype.hasOwnProperty.call(model.computed, field)
          ? ` "${field}" is a computed field, which has no column to sort by.`
          : "";
      fail(model, `orderBy: unknown field ${JSON.stringify(field)} on model "${model.name}".${computedHint} Known fields: ${known}`);
    }
  }
  return entries;
}

/**
 * The shape half of normalizeOrderBy(): turns every accepted spelling of `orderBy`
 * (`"-views"`, `["title", "desc"]`, `["a", "-b"]`, `{ field, direction }`, a list of
 * those) into `[{ field, direction }]`, rejecting a malformed entry, a bad direction or a
 * repeated field via `fail(message)`. It does NOT check that a field exists - the caller
 * knows what can be sorted (an ordinary query: model fields; an aggregate: group keys and
 * aggregate aliases).
 *
 * @param {unknown} orderBy
 * @param {(message: string) => never} fail
 * @returns {Array<{ field: string, direction: "asc"|"desc" }>}
 */
export function parseOrderBy(orderBy, fail) {
  if (orderBy === undefined || orderBy === null) return [];
  const items = Array.isArray(orderBy) && !isPair(orderBy) ? orderBy : [orderBy];
  const result = [];

  for (const item of items) {
    let field;
    let direction = "asc";

    if (typeof item === "string") {
      field = item;
      if (field.startsWith("-")) {
        field = field.slice(1);
        direction = "desc";
      }
    } else if (Array.isArray(item)) {
      [field, direction = "asc"] = item;
    } else if (item && typeof item === "object") {
      field = item.field;
      direction = item.direction ?? "asc";
    } else {
      fail(`orderBy entries must be a field name, [field, direction] or { field, direction } (got ${JSON.stringify(item)})`);
    }

    direction = typeof direction === "string" ? direction.toLowerCase() : direction;
    if (!DIRECTIONS.has(direction)) {
      fail(`orderBy direction must be "asc" or "desc" (got ${JSON.stringify(direction)})`);
    }
    if (typeof field !== "string" || field === "") {
      fail(`orderBy: unknown field ${JSON.stringify(field)}`);
    }
    if (result.some((entry) => entry.field === field)) {
      fail(`orderBy lists "${field}" more than once`);
    }
    result.push({ field, direction });
  }
  return result;
}

// ["title", "desc"] is one [field, direction] pair, not two field names.
function isPair(value) {
  return value.length === 2 && typeof value[0] === "string" && typeof value[1] === "string" && DIRECTIONS.has(value[1].toLowerCase()) && !DIRECTIONS.has(value[0].toLowerCase());
}

function fail(model, message) {
  throw new ValidationError(model.name, { _: [message] });
}

/**
 * Validates `limit` / `offset`: non-negative integers when given.
 */
export function validatePaging(model, { limit, offset }) {
  for (const [name, value] of [["limit", limit], ["offset", offset]]) {
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < 0) {
      fail(model, `${name} must be a non-negative integer (got ${JSON.stringify(value)})`);
    }
  }
}

/**
 * Applies ordering and paging to a Knex query builder.
 *
 * Pages are only stable if the order is total, so whenever the caller
 * orders or skips rows, the primary key is appended as a final
 * tie-breaker (unless it is already in the list). A bare `limit` with no
 * `orderBy` and no `offset` stays exactly as it always was: unordered.
 *
 * @returns {import('knex').Knex.QueryBuilder}
 */
export function applyOrderAndPaging(query, model, { orderBy, limit, offset }) {
  validatePaging(model, { limit, offset });
  const order = normalizeOrderBy(model, orderBy);

  const key = primaryKeyOf(model);
  if ((order.length > 0 || offset !== undefined) && key !== null && !order.some((entry) => entry.field === key)) {
    order.push({ field: key, direction: "asc" });
  }

  for (const { field, direction } of order) query = query.orderBy(model.columns[field], direction);
  if (limit !== undefined) query = query.limit(limit);
  if (offset !== undefined && offset > 0) query = query.offset(offset); // OFFSET 0 is a no-op; leave it out
  return query;
}
