import { fromRow } from "../crud/row-mapping.js";
import { planSelect, stripHidden } from "../crud/select.js";
import { RelationError } from "./errors.js";
import { resolveLocalKey } from "./keys.js";
import { normalizeWith, parentKeysNeeded } from "./with-spec.js";
import { primaryKeyOf } from "../models/primary-key.js";

/**
 * Fails clearly when the records being loaded onto don't carry the field a relation is
 * matched by. Happens when a record came from `find({ select })` without its join key and
 * is then passed to `load()`; `find({ with })` adds the keys it needs on its own.
 */
function assertKeysLoaded(records, keys, relationName, model) {
  for (const key of keys) {
    if (records.some((record) => !(key in record))) {
      throw new RelationError(
        `Cannot load relation "${relationName}" on model "${model.name}": "${key}" was not loaded on the record ` +
          `(it was left out of \`select\`). Add "${key}" to the select.`
      );
    }
  }
}

/**
 * Batch-loads one relation for a whole set of already-fetched records
 * and attaches the result onto each record under `relationName`.
 * Exactly one additional query is issued (two for belongsToMany: one
 * against the pivot table, one against the related table) regardless
 * of how many records are in `records` - this is the N+1 prevention
 * the roadmap calls for. See defineRelation() for what `foreignKey`/
 * `localKey` mean for each relation type; the logic below mirrors
 * that direction exactly.
 *
 * `node` is this relation's normalized `with` entry (see with-spec.js). When it carries a
 * `select`, only those columns are read - plus whatever join keys this relation, and the
 * relations nested under it, need to match rows up. Those extra fields are reported back
 * as `hidden` so the caller can remove them once nothing needs them any more.
 *
 * @param {import('knex').Knex} db
 * @param {import('../models/registry.js').ModelRegistry} modelRegistry
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {Record<string, unknown>[]} records
 * @param {string} relationName
 * @param {import('./with-spec.js').WithNode} node
 * @param {import('../fields/registry.js').FieldTypeRegistry} fieldTypeRegistry
 * @returns {Promise<{ relatedModel: object, related: Record<string, unknown>[], hidden: string[] }>}
 *   `related` is every distinct related record loaded (each object once, however many parents share it)
 */
async function loadOneRelation(db, modelRegistry, model, records, relationName, node, fieldTypeRegistry) {
  const relation = model.relations?.[relationName];
  if (!relation) {
    throw new RelationError(`Unknown relation "${relationName}" on model "${model.name}"`);
  }
  const relatedModel = modelRegistry.getModel(relation.model); // throws UnknownModelError if missing
  const localKey = resolveLocalKey(relation, model, relatedModel);
  const nestedKeys = parentKeysNeeded(relatedModel, modelRegistry, node.with);
  const table = relatedModel.tableName;
  const windowed = node.limit !== undefined || node.offset !== undefined;

  const toRecords = (rows, plan) => rows.map((row) => fromRow(relatedModel, row, fieldTypeRegistry, { computed: plan.computed }));

  /** ORDER BY for the related rows: the requested order, then the primary key so ties (and a limit) are deterministic. */
  const orderFor = (prefix) => {
    const entries = [...node.order];
    const key = primaryKeyOf(relatedModel);
    if ((windowed || entries.length > 0) && key !== null && !entries.some((e) => e.field === key)) entries.push({ field: key, direction: "asc" });
    return entries.map((e) => ({ column: `${prefix}${relatedModel.columns[e.field]}`, direction: e.direction }));
  };

  /**
   * Reads the related rows for one set of parent values, in ONE statement however many parents there
   * are. Without a limit it is a WHERE ... IN (...) (plus the node's `where` and `orderBy`). With a
   * limit/offset - per PARENT, not overall - each parent's rows are numbered by the window function
   * `row_number() OVER (PARTITION BY <parent key> ORDER BY ...)` and the outer query keeps the wanted
   * numbers. `partition` is the column that says which parent a row belongs to.
   */
  const read = async (matchColumn, values, ownKey) => {
    const plan = planSelect(relatedModel, node.select, [ownKey, ...nestedKeys]);
    let query = db(table).whereIn(matchColumn, values);
    if (node.whereFn) query = query.where(node.whereFn);

    let rows;
    if (windowed) {
      const order = orderFor("");
      const orderBy = order.map((o) => `?? ${o.direction === "desc" ? "DESC" : "ASC"}`).join(", ");
      const inner = query
        .select(plan.columns ?? `${table}.*`)
        .select(db.raw(`row_number() OVER (PARTITION BY ?? ORDER BY ${orderBy}) AS ??`, [matchColumn, ...order.map((o) => o.column), RANK]));
      rows = await rankWindow(db, inner, plan.columns, node);
    } else {
      if (plan.columns) query = query.select(plan.columns);
      for (const { column, direction } of orderFor("")) query = query.orderBy(column, direction);
      rows = await query;
    }
    return { hidden: plan.hidden, related: toRecords(rows, plan) };
  };
  const nothing = { relatedModel, related: [], hidden: [] };

  if (relation.type === "belongsTo") {
    assertKeysLoaded(records, [relation.foreignKey], relationName, model);
    const fkValues = uniqueDefined(records.map((r) => r[relation.foreignKey]));

    if (fkValues.length === 0) {
      for (const r of records) r[relationName] = null;
      return nothing;
    }
    const { related, hidden } = await read(relatedModel.columns[localKey], fkValues, localKey);
    const byLocalKey = new Map(related.map((rec) => [rec[localKey], rec]));

    for (const r of records) {
      r[relationName] = byLocalKey.get(r[relation.foreignKey]) ?? null;
    }
    return { relatedModel, related, hidden };
  }

  if (relation.type === "hasOne" || relation.type === "hasMany") {
    assertKeysLoaded(records, [localKey], relationName, model);
    const localValues = uniqueDefined(records.map((r) => r[localKey]));

    if (localValues.length === 0) {
      for (const r of records) r[relationName] = relation.type === "hasMany" ? [] : null;
      return nothing;
    }
    const { related, hidden } = await read(relatedModel.columns[relation.foreignKey], localValues, relation.foreignKey);

    const grouped = new Map();
    for (const rec of related) {
      const key = rec[relation.foreignKey];
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(rec);
    }
    for (const r of records) {
      const group = grouped.get(r[localKey]) ?? [];
      r[relationName] = relation.type === "hasMany" ? group : group[0] ?? null;
    }
    return { relatedModel, related, hidden };
  }

  if (relation.type === "belongsToMany") {
    assertKeysLoaded(records, [localKey], relationName, model);
    const localValues = uniqueDefined(records.map((r) => r[localKey]));
    if (localValues.length === 0) {
      for (const r of records) r[relationName] = [];
      return nothing;
    }
    // The related side of a pivot join is matched against that model's primary key.
    const relatedKey = primaryKeyOf(relatedModel);
    if (relatedKey === null) {
      throw new RelationError(
        `Cannot load belongsToMany "${relationName}" on model "${model.name}": related model "${relatedModel.name}" has no primary key to match the pivot's "${relation.otherKey}" against.`
      );
    }

    // Ordering or limiting a many-to-many needs the pivot and the related rows together (the order is by
    // the RELATED row's columns, and a limit counts per parent), so that case is one joined statement.
    if (windowed || node.order.length > 0) {
      const plan = planSelect(relatedModel, node.select, [relatedKey, ...nestedKeys]);
      const related = (node.whereFn ? db(table).where(node.whereFn) : db(table)).as("t");
      const order = orderFor("t.");

      let query = db({ pv: relation.through })
        .join(related, `t.${relatedModel.columns[relatedKey]}`, `pv.${relation.otherKey}`)
        .whereIn(`pv.${relation.foreignKey}`, localValues)
        .select(db.raw("?? AS ??", [`pv.${relation.foreignKey}`, PARENT]))
        .select(plan.columns ? plan.columns.map((c) => `t.${c}`) : "t.*");

      let rows;
      if (windowed) {
        const orderBy = order.map((o) => `?? ${o.direction === "desc" ? "DESC" : "ASC"}`).join(", ");
        query = query.select(db.raw(`row_number() OVER (PARTITION BY ?? ORDER BY ${orderBy}) AS ??`, [`pv.${relation.foreignKey}`, ...order.map((o) => o.column), RANK]));
        rows = await rankWindow(db, query, plan.columns ? [...plan.columns.map((c) => c), PARENT] : null, node, PARENT);
      } else {
        for (const { column, direction } of order) query = query.orderBy(column, direction);
        rows = await query;
      }

      // The same related row may sit under several parents: one object, shared, as in the unordered path.
      const byKey = new Map();
      const byParent = new Map();
      for (const row of rows) {
        const [record] = toRecords([row], plan);
        const key = record[relatedKey];
        if (!byKey.has(key)) byKey.set(key, record);
        if (!byParent.has(row[PARENT])) byParent.set(row[PARENT], []);
        byParent.get(row[PARENT]).push(byKey.get(key));
      }
      for (const r of records) r[relationName] = byParent.get(r[localKey]) ?? [];
      return { relatedModel, related: [...byKey.values()], hidden: plan.hidden };
    }

    // Only the two link columns are needed from the pivot table.
    const pivotRows = await db(relation.through)
      .select(relation.foreignKey, relation.otherKey)
      .whereIn(relation.foreignKey, localValues);
    const relatedIds = uniqueDefined(pivotRows.map((row) => row[relation.otherKey]));

    let related = [];
    let hidden = [];
    let relatedById = new Map();
    if (relatedIds.length > 0) {
      ({ related, hidden } = await read(relatedModel.columns[relatedKey], relatedIds, relatedKey));
      relatedById = new Map(related.map((rec) => [rec[relatedKey], rec]));
    }

    const idsByLocalKey = new Map();
    for (const row of pivotRows) {
      const key = row[relation.foreignKey];
      if (!idsByLocalKey.has(key)) idsByLocalKey.set(key, []);
      idsByLocalKey.get(key).push(row[relation.otherKey]);
    }

    for (const r of records) {
      const ids = idsByLocalKey.get(r[localKey]) ?? [];
      r[relationName] = ids.map((id) => relatedById.get(id)).filter((rec) => rec !== undefined);
    }
    return { relatedModel, related, hidden };
  }

  return nothing;
}

const RANK = "__rank";
const PARENT = "__parent";

/**
 * Wraps a query that selects a `__rank` column (a per-parent row number) and keeps only the wanted
 * ranks: `offset < rank <= offset + limit`. The outer query orders by rank, so each parent's rows
 * come back in the requested order. `columns` are the columns to carry out (null = all of them).
 */
async function rankWindow(db, inner, columns, node, extraColumn = null) {
  const offset = node.offset ?? 0;
  let outer = db.select(columns ? [...columns, ...(extraColumn && !columns.includes(extraColumn) ? [extraColumn] : [])] : "*").from(inner.as("ranked"));
  outer = outer.where(RANK, ">", offset);
  if (node.limit !== undefined) outer = outer.where(RANK, "<=", offset + node.limit);
  return outer.orderBy(RANK);
}

function uniqueDefined(values) {
  return [...new Set(values.filter((v) => v !== null && v !== undefined))];
}

async function loadTree(db, modelRegistry, model, records, tree, fieldTypeRegistry) {
  if (records.length === 0) return records;

  for (const [relationName, node] of tree) {
    const { relatedModel, related, hidden } = await loadOneRelation(
      db, modelRegistry, model, records, relationName, node, fieldTypeRegistry
    );

    // `related` holds each distinct object once, so records shared between parents (every belongsTo
    // lookup for the same key returns the same instance) are never re-queried for the nested level.
    if (node.with.size > 0 && related.length > 0) {
      await loadTree(db, modelRegistry, relatedModel, related, node.with, fieldTypeRegistry);
    }
    // Join keys were only needed to match rows up (here and for the levels below); now they can go.
    stripHidden(related, hidden);
  }
  return records;
}

/**
 * Loads every relation named in `withSpec` for `records`, mutating each record in place and
 * returning the same array. A no-op for an empty `records` array (no queries issued at all).
 *
 * `withSpec` is anything `find({ with })` accepts (see with-spec.js): relation names,
 * dotted paths, and/or `{ relation: { select, with } }` objects. It is validated up front,
 * before any query runs.
 *
 * Supports dot-path nesting - `"items.product"` loads `items` on
 * `model` first (one batched query), then recurses onto every loaded
 * item to load `product` on THEM (another batched query, deduplicated
 * by object reference first so records that share the same related
 * row - e.g. many order items pointing at the same product - aren't
 * redundantly re-queried). Arbitrary depth works the same way,
 * recursively: `"items.product.tags"` loads three levels, each still
 * one query per level regardless of how many records are at that
 * level - the N+1 guarantee holds at every depth, not just the first.
 * Field selection changes which columns each of those queries reads, never how many run.
 *
 * @param {import('knex').Knex} db
 * @param {import('../models/registry.js').ModelRegistry} modelRegistry
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {Record<string, unknown>[]} records
 * @param {unknown} withSpec - relation names / paths / `{ relation: { select, with } }`
 * @param {import('../fields/registry.js').FieldTypeRegistry} fieldTypeRegistry
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function eagerLoad(db, modelRegistry, model, records, withSpec, fieldTypeRegistry) {
  const tree = withSpec instanceof Map ? withSpec : normalizeWith(model, modelRegistry, withSpec, fieldTypeRegistry);
  return loadTree(db, modelRegistry, model, records, tree, fieldTypeRegistry);
}
