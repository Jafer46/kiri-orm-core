import { ValidationError } from "./errors.js";
import { primaryKeyOf } from "../models/primary-key.js";

/**
 * Field selection for `find({ select })`: which columns to read, and what has to ride
 * along so the result is still correct.
 *
 * Three things are kept apart on purpose:
 *
 * - what the caller ASKED for (`select`, validated by normalizeSelect());
 * - what that IMPLIES - a computed field can't be read without the stored fields it
 *   `depends` on (transitively, through other computed fields), so those are loaded
 *   too and appear on the record like any other selected field (expandSelect());
 * - what the ORM needs for ITS OWN bookkeeping - the join keys eager loading matches
 *   rows by. These are fetched too but are NOT part of the result unless asked for,
 *   so `select: ["title"]` with `with: ["author"]` doesn't leak `authorId`
 *   (planSelect().hidden, removed by stripHidden() once loading is done).
 */

/**
 * Validates `select` and returns it as a de-duplicated array of field names, or `null`
 * when there is no selection (meaning: every field, exactly as before `select` existed).
 * Stored and computed fields are both accepted.
 *
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {unknown} select
 * @returns {string[]|null}
 * @throws {ValidationError}
 */
export function normalizeSelect(model, select) {
  if (select === undefined || select === null) return null;
  const fail = (message) => {
    throw new ValidationError(model.name, { select: [message] });
  };

  if (!Array.isArray(select)) fail(`\`select\` must be an array of field names, got ${typeof select}`);
  if (select.length === 0) fail("`select` must name at least one field (leave it out to load every field)");

  const computed = model.computed ?? {};
  const known = () => `Fields: ${[...Object.keys(model.fields), ...Object.keys(computed).map((n) => `${n} (computed)`)].join(", ")}`;
  const names = [];
  for (const name of select) {
    if (typeof name !== "string" || name === "") fail(`\`select\` entries must be field names (non-empty strings), got ${JSON.stringify(name)}`);
    if (!(name in model.fields) && !(name in computed)) {
      if (model.relations && name in model.relations) {
        fail(`"${name}" is a relation, not a field. Load it with \`with\`, e.g. { with: { ${name}: { select: [...] } } }`);
      }
      fail(`unknown field "${name}". ${known()}`);
    }
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * Splits a validated selection into the stored fields to read and the computed fields to
 * define, following `depends` transitively: `fullName` depends on `firstName` and
 * `initials`, `initials` depends on `firstName` and `lastName` -> stored { firstName,
 * lastName }, computed { fullName, initials }.
 *
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {string[]} names - output of normalizeSelect()
 * @returns {{ fields: Set<string>, computed: Set<string> }}
 */
export function expandSelect(model, names) {
  const fields = new Set();
  const computed = new Set();
  const visit = (name) => {
    if (name in model.fields) {
      fields.add(name);
      return;
    }
    if (computed.has(name)) return;
    computed.add(name);
    for (const dep of model.computed[name].depends) visit(dep);
  };
  names.forEach(visit);
  return { fields, computed };
}

/**
 * Turns a (possibly absent) selection plus the join keys some relation needs into what
 * the query should read.
 *
 * - `columns`: column names to `select`, or `null` for "all columns" (no selection made;
 *   the SQL is then identical to what it was before `select` existed).
 * - `computed`: the computed fields to define on each record, or `null` for "all". A
 *   computed field whose dependencies weren't loaded would compute from `undefined`, so
 *   with a selection only the requested ones (and what they need) are defined.
 * - `hidden`: fields read only because `requiredKeys` needs them; strip them from the
 *   result with stripHidden() once whatever needed them is done.
 *
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {string[]|null} names - output of normalizeSelect()
 * @param {string[]} [requiredKeys] - stored fields that must be read regardless
 * @returns {{ columns: string[]|null, computed: Set<string>|null, hidden: string[] }}
 */
export function planSelect(model, names, requiredKeys = []) {
  if (names === null) return { columns: null, computed: null, hidden: [] };

  const { fields, computed } = expandSelect(model, names);
  const hidden = [];
  for (const key of requiredKeys) {
    if (!fields.has(key) && !hidden.includes(key)) hidden.push(key);
  }
  if (fields.size === 0 && hidden.length === 0) {
    // Only computed fields with no stored dependencies (a constant, say). An empty column
    // list would make Knex read every column, so read one and hide it.
    hidden.push(primaryKeyOf(model) ?? Object.keys(model.fields)[0]);
  }
  return {
    columns: [...fields, ...hidden].map((field) => model.columns[field]),
    computed,
    hidden,
  };
}

/** Removes fields that were read only for the ORM's own use (see planSelect().hidden). */
export function stripHidden(records, hidden) {
  if (hidden.length === 0) return;
  for (const record of records) {
    for (const field of hidden) delete record[field];
  }
}

/**
 * For the tracked APIs (`client.models.x.find`, global `Model.find`): a document needs its
 * primary key for `save()`, `delete()` and the identity map, so it is always read even if
 * `select` left it out. Plain `Repository.find` returns exactly what was asked for.
 *
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {object} [options] - find options
 * @returns {object} `options`, with the primary key added to `select` when needed
 */
export function withPrimaryKey(model, options = {}) {
  const names = normalizeSelect(model, options.select);
  const key = primaryKeyOf(model);
  if (names === null || key === null || names.includes(key)) return options;
  return { ...options, select: [key, ...names] };
}
