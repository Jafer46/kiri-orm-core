import { prepareWrite } from "./prepare-write.js";
import { ValidationError } from "./errors.js";
import { chunkArray, insertRecords, rowsPerStatement } from "./insert-many.js";
import { castValue } from "../fields/cast-value.js";
import { normalizeRelationValue } from "../relations/commands.js";
import { attachPairs } from "../relations/attach-detach.js";
import { RelationError } from "../relations/errors.js";
import { resolveLocalKey } from "../relations/keys.js";
import { primaryKeyOf } from "../models/primary-key.js";

/**
 * Batched record creation - the engine behind `createMany()` (and,
 * since a create is just a batch of one, `create()`) on every API
 * surface: Repository, UnitOfWork / `client.models`, and the global
 * `createModel()` API.
 *
 * ## Why this exists: query count must not scale with row count
 *
 * Creating N records and their relations one at a time costs several
 * statements *per record*. Here it costs a fixed number per
 * *relation*, however many records are involved. Modeled on how Odoo
 * does it: `create()` takes a list, and relational fields are written
 * by a batch step that receives every (record, value) pair at once and
 * issues one combined write, rather than once per record.
 *
 *   - Parent rows: one multi-row `INSERT ... RETURNING` per chunk.
 *   - `hasMany`, Command.create: children for ALL parents are pooled
 *     into one nested createMany on the child model.
 *   - `belongsToMany`: related rows (if any are created) are pooled the
 *     same way, then every pivot row for every parent goes in as one
 *     chunked INSERT.
 *   - Nesting recurses through the same code, so
 *     order -> items -> item.tags is still one write per level.
 *
 * ## Phases and where hooks run
 *
 * 1. **Prepare** (no writes): for each top-level row run
 *    `beforeCreate`/`beforeSave`, validate, and normalize relation
 *    payloads. Nothing has touched the database yet, so a bad row 9,999
 *    of an import fails before anything is written, and these hooks
 *    run outside the write transaction (matters for hooks that use a
 *    separate connection).
 * 2. **Execute** (one transaction, opened only if there's more than one
 *    statement to run): insert, then write relations. Nested children
 *    are prepared here - because their foreign key only exists once
 *    the parent row does, so their `beforeCreate` hooks see it - which
 *    means nested validation errors surface after the parent insert
 *    and roll it back.
 * 3. **After commit**: entities are built (`runtime.wrap`) and
 *    `afterCreate`/`afterSave` run - parents first, then children -
 *    so a failing hook can't leave the entity map showing rows that
 *    were rolled back.
 *
 * @typedef {Object} CreateRuntime
 * @property {import('knex').Knex} db - connection used unless `options.trx` overrides it
 * @property {import('../models/registry.js').ModelRegistry} [modelRegistry] - needed only when payloads contain relations
 * @property {import('../fields/registry.js').FieldTypeRegistry} fieldTypeRegistry
 * @property {import('../uow/hooks.js').HookRegistry} [hooks] - omit for hook-free creation (plain Repository)
 * @property {(modelName: string, record: Record<string, unknown>) => object} [wrap] - turns a stored record into what callers
 *   get back (a tracked entity); omit to return plain records
 */

/**
 * A pathological input (say, a wrong column mapping over 100k rows)
 * would otherwise produce one error entry per row. Twenty is plenty to
 * show the pattern.
 */
const MAX_REPORTED_INVALID_ROWS = 20;
const ID_CHUNK = 500;

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function joinLabel(label, name) {
  return label ? `${label}.${name}` : name;
}

/**
 * Separates a create payload's relation keys from its field keys.
 * (defineModel() forbids a relation sharing a field's name, so a key
 * is unambiguously one or the other.)
 */
function splitRelationKeys(model, data) {
  const relations = model.relations ?? {};
  const relationKeys = Object.keys(data).filter((key) => has(relations, key));
  if (relationKeys.length === 0) return { fieldData: data, relationKeys };

  const fieldData = {};
  for (const key of Object.keys(data)) {
    if (!has(relations, key)) fieldData[key] = data[key];
  }
  return { fieldData, relationKeys };
}

/**
 * Looks up (and sanity-checks, once per model+relation) everything a
 * relation write needs to know about the other side.
 */
function resolveTarget(ctx, model, relationName) {
  const cacheKey = `${model.name}.${relationName}`;
  const cached = ctx.targets.get(cacheKey);
  if (cached) return cached;

  const relation = model.relations[relationName];
  const where = `relation "${relationName}" on model "${model.name}"`;

  if (!ctx.runtime.modelRegistry) {
    throw new RelationError(
      `Writing ${where} requires a modelRegistry (construct the Repository with one, or use RepositoryFactory / createClient).`
    );
  }
  const relatedModel = ctx.runtime.modelRegistry.getModel(relation.model); // UnknownModelError if unregistered
  const localKey = resolveLocalKey(relation, model, relatedModel);
  if (!has(model.fields, localKey)) {
    throw new RelationError(`${where}: localKey "${localKey}" is not a field of "${model.name}"`);
  }
  if (primaryKeyOf(relatedModel) === null) {
    throw new RelationError(
      `${where}: related model "${relatedModel.name}" has no primary key, which writing this relation needs. ` +
        `Declare one with \`primaryKey\` on the model, or add a field named "id".`
    );
  }
  if (relation.type === "hasMany" && !has(relatedModel.fields, relation.foreignKey)) {
    throw new RelationError(`${where}: foreignKey "${relation.foreignKey}" is not a field of "${relatedModel.name}"`);
  }

  const target = { relation, relatedModel, where, localKey };
  ctx.targets.set(cacheKey, target);
  return target;
}

/**
 * Phase 1 for one level: hooks, validation, and relation-payload
 * normalization for every row. Performs no writes.
 *
 * @returns {Promise<Array<{ label: string, values: Record<string, unknown>, commands: Record<string, object[]>|null, record?: Record<string, unknown> }>>}
 */
async function prepareLevel(ctx, model, dataList, labels) {
  const { runtime } = ctx;
  const rows = [];
  const errors = {};
  let invalidRows = 0;

  for (let i = 0; i < dataList.length; i++) {
    const data = dataList[i];
    const label = labels[i];

    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      throw new TypeError(
        `Cannot create model "${model.name}": entry ${label || "[0]"} must be an object of field values`
      );
    }

    if (runtime.hooks) {
      await runtime.hooks.run(model.name, "beforeCreate", data);
      await runtime.hooks.run(model.name, "beforeSave", data, undefined);
    }

    const { fieldData, relationKeys } = splitRelationKeys(model, data);
    const { errors: fieldErrors, values } = prepareWrite(model, fieldData, { partial: false }, runtime.fieldTypeRegistry);

    let commands = null;
    for (const relationName of relationKeys) {
      if (data[relationName] === undefined) continue;
      const ops = normalizeRelationValue(model.name, relationName, model.relations[relationName], data[relationName]);
      resolveTarget(ctx, model, relationName); // fail on a bad relation definition now, not mid-transaction
      commands ??= {};
      commands[relationName] = ops;
    }

    if (Object.keys(fieldErrors).length > 0) {
      invalidRows += 1;
      for (const [field, messages] of Object.entries(fieldErrors)) {
        errors[joinLabel(label, field)] = messages;
      }
      if (invalidRows >= MAX_REPORTED_INVALID_ROWS) {
        errors._ = [`stopped after ${MAX_REPORTED_INVALID_ROWS} invalid rows; later rows were not checked`];
        break;
      }
      continue;
    }

    rows.push({ label, values, commands });
  }

  if (Object.keys(errors).length > 0) {
    throw new ValidationError(model.name, errors);
  }
  return rows;
}

/** Phase 2 for one level: insert the rows, then write their relations. */
async function executeLevel(ctx, model, rows) {
  const records = await insertRecords(
    ctx.db,
    model,
    rows.map((row) => row.values),
    ctx.runtime.fieldTypeRegistry,
    { chunkSize: ctx.chunkSize }
  );

  const entries = records.map((record) => {
    const entry = { model, record, result: undefined };
    ctx.created.push(entry);
    return entry;
  });
  rows.forEach((row, i) => {
    row.record = records[i];
  });

  await writeRelations(ctx, model, rows);
  return entries;
}

/** Prepare + execute for a nested level; returns stored records aligned to `dataList`. */
async function createLevel(ctx, model, dataList, labels) {
  const rows = await prepareLevel(ctx, model, dataList, labels);
  const entries = await executeLevel(ctx, model, rows);
  return entries.map((entry) => entry.record);
}

function parentKeyOf(row, localKey, model, relationName) {
  const key = row.record[localKey];
  if (key === undefined || key === null) {
    throw new RelationError(
      `Cannot write relation "${relationName}" on model "${model.name}": the created record has no value for "${localKey}"`
    );
  }
  return key;
}

function castRelatedId(ctx, relatedModel, id, where) {
  try {
    return castValue(relatedModel.fields[primaryKeyOf(relatedModel)], id, ctx.runtime.fieldTypeRegistry);
  } catch (err) {
    throw new RelationError(`${where}: invalid id ${JSON.stringify(id)} (${err.message})`);
  }
}

/**
 * Writes every relation named in any row's commands. Each relation is
 * handled once for ALL rows together - this is the loop that keeps
 * query count independent of row count.
 */
async function writeRelations(ctx, model, rows) {
  for (const relationName of Object.keys(model.relations ?? {})) {
    const involved = rows.filter((row) => row.commands?.[relationName]?.length > 0);
    if (involved.length === 0) continue;

    const { relation } = resolveTarget(ctx, model, relationName);
    if (relation.type === "hasMany") {
      await writeHasMany(ctx, model, relationName, involved);
    } else {
      await writeBelongsToMany(ctx, model, relationName, involved);
    }
  }
}

async function writeHasMany(ctx, model, relationName, rows) {
  const { relation, relatedModel, where, localKey } = resolveTarget(ctx, model, relationName);

  const creates = [];
  const createLabels = [];
  const linksByParent = new Map(); // parent key -> child ids

  for (const row of rows) {
    const parentKey = parentKeyOf(row, localKey, model, relationName);
    for (const op of row.commands[relationName]) {
      if (op.type === "create") {
        const data = { ...op.values };
        if (has(data, relation.foreignKey) && String(data[relation.foreignKey]) !== String(parentKey)) {
          throw new RelationError(
            `${where}, entry [${op.index}]: "${relation.foreignKey}" is ${JSON.stringify(data[relation.foreignKey])} ` +
              `but this record belongs to parent ${JSON.stringify(parentKey)}. Omit it - it is set for you.`
          );
        }
        data[relation.foreignKey] = parentKey;
        creates.push(data);
        createLabels.push(joinLabel(row.label, `${relationName}[${op.index}]`));
      } else {
        const id = castRelatedId(ctx, relatedModel, op.id, `${where}, entry [${op.index}]`);
        if (!linksByParent.has(parentKey)) linksByParent.set(parentKey, []);
        linksByParent.get(parentKey).push(id);
      }
    }
  }

  // Every parent's new children go in together, in one nested createMany.
  if (creates.length > 0) {
    await createLevel(ctx, relatedModel, creates, createLabels);
  }

  // Linking existing children means re-pointing their foreign key.
  // Children sharing a parent share one UPDATE.
  const idColumn = relatedModel.columns[primaryKeyOf(relatedModel)];
  const fkColumn = relatedModel.columns[relation.foreignKey];
  for (const [parentKey, ids] of linksByParent) {
    const unique = [...new Set(ids)];
    let affected = 0;
    for (const chunk of chunkArray(unique, ID_CHUNK)) {
      affected += await ctx.db(relatedModel.tableName).whereIn(idColumn, chunk).update({ [fkColumn]: parentKey });
    }
    if (affected < unique.length) {
      throw new RelationError(
        `${where}: Command.link() matched ${affected} of ${unique.length} "${relatedModel.name}" records ` +
          `for parent ${JSON.stringify(parentKey)} - some ids do not exist`
      );
    }
  }
}

async function writeBelongsToMany(ctx, model, relationName, rows) {
  const { relation, relatedModel, where, localKey } = resolveTarget(ctx, model, relationName);

  const pairs = []; // [source key, target id]
  const creates = [];
  const createOwners = [];
  const createLabels = [];

  for (const row of rows) {
    const sourceKey = parentKeyOf(row, localKey, model, relationName);
    for (const op of row.commands[relationName]) {
      if (op.type === "create") {
        creates.push({ ...op.values });
        createOwners.push(sourceKey);
        createLabels.push(joinLabel(row.label, `${relationName}[${op.index}]`));
      } else {
        pairs.push([sourceKey, castRelatedId(ctx, relatedModel, op.id, `${where}, entry [${op.index}]`)]);
      }
    }
  }

  // Related rows to create are pooled across every parent, then
  // paired back up with their owner by position.
  if (creates.length > 0) {
    const createdRecords = await createLevel(ctx, relatedModel, creates, createLabels);
    const relatedKey = primaryKeyOf(relatedModel);
    createdRecords.forEach((record, i) => pairs.push([createOwners[i], record[relatedKey]]));
  }

  // The parents were created in this same operation, so no
  // association can exist yet - skip the existence check.
  await attachPairs(ctx.db, relation, pairs, { checkExisting: false, chunkSize: ctx.chunkSize });
}

/**
 * Creates every record in `dataList` (and any relations named in
 * their payloads) with a query count independent of how many there are.
 * All-or-nothing: if anything fails, nothing is written.
 *
 * @param {CreateRuntime} runtime
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {Record<string, unknown>[]} dataList
 * @param {Object} [options]
 * @param {import('knex').Knex.Transaction} [options.trx] - run inside this transaction instead of opening one
 * @param {number} [options.chunkSize] - lower the rows-per-INSERT below the dialect's limit
 * @param {string[]} [options.labels] - per-row prefixes for validation error keys; defaults to
 *   `[0]`, `[1]`, ...; `create()` passes `[""]` so its error keys stay plain field names
 * @returns {Promise<object[]>} one result per input, in input order (`runtime.wrap`'s output, else the stored record)
 * @throws {ValidationError} row-level problems, keyed by row (`[3].title`, `[3].items[1].quantity`)
 * @throws {RelationError} malformed relation payloads
 */
export async function createRecords(runtime, model, dataList, options = {}) {
  if (!Array.isArray(dataList)) {
    throw new TypeError(`createMany() for model "${model.name}" expects an array of records`);
  }
  if (dataList.length === 0) return [];

  const labels = options.labels ?? dataList.map((_, i) => `[${i}]`);
  const baseDb = options.trx ?? runtime.db;
  const ctx = { runtime, db: baseDb, chunkSize: options.chunkSize, created: [], targets: new Map() };

  // Phase 1 - nothing is written.
  const rows = await prepareLevel(ctx, model, dataList, labels);

  // Phase 2 - a lone INSERT is atomic by itself; anything more needs a transaction.
  const hasRelationWork = rows.some((row) => row.commands && Object.values(row.commands).some((ops) => ops.length > 0));
  const insertStatements = Math.ceil(rows.length / rowsPerStatement(baseDb, Object.keys(model.fields).length, options.chunkSize));

  let rootEntries;
  if (!baseDb.isTransaction && (hasRelationWork || insertStatements > 1)) {
    await baseDb.transaction(async (trx) => {
      rootEntries = await executeLevel({ ...ctx, db: trx }, model, rows);
    });
  } else {
    rootEntries = await executeLevel(ctx, model, rows);
  }

  // Phase 3 - committed; now build entities and fire after-hooks.
  for (const entry of ctx.created) {
    entry.result = runtime.wrap ? runtime.wrap(entry.model.name, entry.record) : entry.record;
  }
  if (runtime.hooks) {
    for (const entry of ctx.created) {
      await runtime.hooks.run(entry.model.name, "afterCreate", entry.result);
      await runtime.hooks.run(entry.model.name, "afterSave", entry.result, undefined);
    }
  }

  return rootEntries.map((entry) => entry.result);
}
