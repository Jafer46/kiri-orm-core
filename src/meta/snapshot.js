import { META_MODELS_TABLE, META_FIELDS_TABLE } from "./reserved-tables.js";

/**
 * A portable, id-free picture of one model's rows in `_meta_models` /
 * `_meta_fields`, including rows flagged as removed. Migrations carry
 * one of these per touched model, for "before" and for "after", so
 * applying or rolling back a migration can put the metadata into
 * exactly the state the schema is now in - without needing the model
 * registry the migration was generated from.
 *
 * `options` is stored parsed (SQLite hands JSON columns back as text,
 * Postgres as objects) so snapshots compare and serialize the same on
 * both.
 *
 * @typedef {Object} ModelMetaSnapshot
 * @property {string} table_name
 * @property {boolean} removed
 * @property {Array<{
 *   name: string, column: string, type: string, required: boolean,
 *   is_unique: boolean, is_indexed: boolean, options: unknown, removed: boolean
 * }>} fields - ordered by name
 */

function parseOptions(options) {
  if (typeof options !== "string") return options ?? null;
  try {
    return JSON.parse(options);
  } catch {
    return options;
  }
}

/**
 * @param {import('knex').Knex} db
 * @param {string} modelName
 * @returns {Promise<ModelMetaSnapshot|null>} null if the model has no metadata row at all
 */
export async function snapshotModelMeta(db, modelName) {
  const model = await db(META_MODELS_TABLE).where({ name: modelName }).first();
  if (!model) return null;

  const rows = await db(META_FIELDS_TABLE).where({ model_id: model.id }).orderBy("name");
  return {
    table_name: model.table_name,
    removed: model.removed_at !== null && model.removed_at !== undefined,
    fields: rows.map((row) => ({
      name: row.name,
      column: row.column,
      type: row.type,
      required: Boolean(row.required),
      is_unique: Boolean(row.is_unique),
      is_indexed: Boolean(row.is_indexed),
      options: parseOptions(row.options),
      removed: row.removed_at !== null && row.removed_at !== undefined,
    })),
  };
}

/**
 * Makes a model's metadata rows match `snapshot` exactly: rows are
 * created or updated to the snapshot's values, rows the snapshot
 * doesn't have are deleted, and `null` deletes the model's metadata
 * entirely (it did not exist in that state). Run it inside the same
 * transaction as the schema change it accompanies.
 *
 * @param {import('knex').Knex} db - ideally a transaction
 * @param {string} modelName
 * @param {ModelMetaSnapshot|null} snapshot
 */
export async function restoreModelMeta(db, modelName, snapshot) {
  const now = new Date();
  const existing = await db(META_MODELS_TABLE).where({ name: modelName }).first();

  if (snapshot === null) {
    if (existing) {
      await db(META_FIELDS_TABLE).where({ model_id: existing.id }).delete();
      await db(META_MODELS_TABLE).where({ id: existing.id }).delete();
    }
    return;
  }

  const modelValues = {
    table_name: snapshot.table_name,
    updated_at: now,
    removed_at: snapshot.removed ? now : null,
  };
  let modelId;
  if (existing) {
    modelId = existing.id;
    await db(META_MODELS_TABLE).where({ id: modelId }).update(modelValues);
  } else {
    await db(META_MODELS_TABLE).insert({ name: modelName, created_at: now, ...modelValues });
    modelId = (await db(META_MODELS_TABLE).where({ name: modelName }).first()).id;
  }

  const existingFields = await db(META_FIELDS_TABLE).where({ model_id: modelId });
  const byName = new Map(existingFields.map((row) => [row.name, row]));
  const wanted = new Set(snapshot.fields.map((field) => field.name));

  for (const row of existingFields) {
    if (!wanted.has(row.name)) await db(META_FIELDS_TABLE).where({ id: row.id }).delete();
  }
  for (const field of snapshot.fields) {
    const values = {
      model_id: modelId,
      model: modelName,
      name: field.name,
      column: field.column,
      type: field.type,
      required: field.required,
      is_unique: field.is_unique,
      is_indexed: field.is_indexed,
      options: field.options === null ? null : JSON.stringify(field.options),
      updated_at: now,
      removed_at: field.removed ? now : null,
    };
    const current = byName.get(field.name);
    if (current) {
      await db(META_FIELDS_TABLE).where({ id: current.id }).update(values);
    } else {
      await db(META_FIELDS_TABLE).insert({ ...values, created_at: now });
    }
  }
}
