import { listModelsMeta, getFieldsMeta } from "../meta/query.js";
import { RELATION_TYPES } from "../relations/define-relation.js";

// Since Phase 7, relations are stored as rows in `_meta_fields` alongside
// scalar fields (see meta/upsert.js). They aren't columns, so they must
// never be diffed against `model.fields`: left in, every relation would
// read as a removed field (a phantom "drop field", or a dropColumn("")).

async function getColumnFieldsMeta(db, modelName) {
  return (await getFieldsMeta(db, modelName)).filter((row) => !RELATION_TYPES.includes(row.type));
}

/**
 * @typedef {Object} DiffPlan
 * @property {string[]} createModels - model names that are entirely new
 * @property {Object[]} dropModels - previously-active models no longer
 *   in the registry: { modelName, tableName, fields, columns } where
 *   `fields`/`columns` are reconstructed from the stored meta rows'
 *   `options` JSON, so a rollback can recreate the table's schema
 *   even though the model no longer exists in code.
 * @property {Object[]} renameModels - { modelName, fromTable, toTable } -
 *   detected with certainty (not a heuristic): the model's `name` is
 *   its stable identity in `_meta_models`, so if that same name's
 *   resolved table name changed, it's unambiguously a rename.
 * @property {{removed: string[], added: string[]}|null} possibleModelRenames -
 *   advisory only: models present in the old snapshot but absent from
 *   the registry, alongside newly-registered models, when neither list
 *   is empty and no explicit `modelRenames` resolved them. There's no
 *   way to know if these are genuinely related without the caller
 *   telling us - this exists purely to prompt "did you mean to rename
 *   one of these?" rather than to guess.
 * @property {Record<string, FieldChangePlan>} fieldChanges - per model
 */

/**
 * @typedef {Object} FieldChangePlan
 * @property {string[]} addFields - new field names on an existing model
 * @property {Object[]} dropFields - { fieldName, columnName, field } for
 *   fields removed from the model; `field` is reconstructed from the
 *   stored meta row's `options` JSON for rollback purposes.
 * @property {Object[]} renameFields - { from, to } - resolved via the
 *   caller's explicit `fieldRenames` option. Fully reversible: a
 *   RENAME COLUMN loses no data.
 * @property {Object[]} columnRenames - { fieldName, fromColumn, toColumn } -
 *   detected with certainty: same field `name` (the stable identity
 *   key in `_meta_fields`), only its resolved column name changed
 *   (e.g. an explicit `column` option was added/changed). Not a
 *   heuristic guess, same reasoning as renameModels above.
 * @property {Object[]} typeChanges - { fieldName, from, to } - flagged
 *   but never auto-migrated (see generateMigration).
 * @property {{removed: string[], added: string[]}|null} possibleFieldRenames -
 *   advisory only, same rationale as possibleModelRenames but at the
 *   field level (e.g. `customerId` renamed to `clientId` in code).
 */

/**
 * Compares `modelRegistry`'s current state against what's recorded in
 * `_meta_models`/`_meta_fields` (Phase 4) - NOT live schema
 * introspection. This is precisely the reason Phase 4 exists: model
 * and field *identity* (their `name`) is stable in the metadata even
 * when their resolved table/column name changes, so a table or column
 * rename is detected with certainty rather than guessed. A field or
 * model being renamed *in code* (a genuinely new identity) can't be
 * known for certain and is only ever surfaced as an advisory
 * `possible...Renames` hint unless the caller explicitly resolves it.
 *
 * @param {import('knex').Knex} db
 * @param {import('../models/registry.js').ModelRegistry} modelRegistry
 * @param {Object} [options]
 * @param {Record<string, string>} [options.modelRenames] - { oldModelName: newModelName }
 * @param {Record<string, Record<string, string>>} [options.fieldRenames] - { modelName: { oldFieldName: newFieldName } }
 * @returns {Promise<DiffPlan>}
 */
export async function diffSchema(db, modelRegistry, options = {}) {
  modelRegistry.assertResolved();
  const modelRenames = options.modelRenames ?? {};
  const fieldRenames = options.fieldRenames ?? {};

  const currentModelNames = new Set(modelRegistry.listModels());
  const previousModelRows = await listModelsMeta(db);
  const previousModelNames = new Set(previousModelRows.map((r) => r.name));

  const removedModelNames = [...previousModelNames].filter((n) => !currentModelNames.has(n));
  const addedModelNames = [...currentModelNames].filter((n) => !previousModelNames.has(n));

  const renameModels = [];
  const dropModelNames = [];

  // Case 1: same model `name` present in both snapshots (identity
  // unchanged), but its resolved `tableName` differs. Exact, not a
  // heuristic - no `modelRenames` input needed, since the identity
  // key itself proves it's the same model.
  for (const modelName of currentModelNames) {
    if (!previousModelNames.has(modelName)) continue;
    const previousRow = previousModelRows.find((r) => r.name === modelName);
    const currentTableName = modelRegistry.getModel(modelName).tableName;
    if (currentTableName !== previousRow.table_name) {
      renameModels.push({
        modelName,
        fromTable: previousRow.table_name,
        toTable: currentTableName,
      });
    }
  }

  // Case 2: the model's `name` itself is different across snapshots -
  // a genuine identity change that can only be resolved via the
  // caller's explicit `modelRenames` (there's no stable key linking
  // old to new here, unlike case 1).
  for (const removedName of removedModelNames) {
    const target = modelRenames[removedName];
    if (target && currentModelNames.has(target)) {
      const previousRow = previousModelRows.find((r) => r.name === removedName);
      renameModels.push({
        modelName: target,
        fromTable: previousRow.table_name,
        toTable: modelRegistry.getModel(target).tableName,
      });
    } else {
      dropModelNames.push(removedName);
    }
  }

  // Maps a Case-2 rename target's current name back to its old name -
  // only populated for genuine identity changes (Case 2), since Case 1
  // renames don't change the model's `name` at all and so need no
  // such mapping (the name IS the lookup key already).
  const identityRenameMap = {};
  for (const removedName of removedModelNames) {
    const target = modelRenames[removedName];
    if (target && currentModelNames.has(target)) {
      identityRenameMap[target] = removedName;
    }
  }

  const renamedToNames = new Set(renameModels.map((r) => r.modelName));
  const createModels = addedModelNames.filter((n) => !renamedToNames.has(n));

  const possibleModelRenames =
    dropModelNames.length > 0 && createModels.length > 0
      ? { removed: dropModelNames, added: createModels }
      : null;

  // Reconstruct dropped models' schema from their stored meta rows,
  // so a rollback can recreate them even though they're gone from
  // the registry.
  const dropModels = [];
  for (const modelName of dropModelNames) {
    const previousRow = previousModelRows.find((r) => r.name === modelName);
    const allRows = await getFieldsMeta(db, modelName);
    const fieldRows = allRows.filter((row) => !RELATION_TYPES.includes(row.type));
    const fields = {};
    const columns = {};
    for (const row of fieldRows) {
      fields[row.name] = parseFieldOptions(row.options);
      columns[row.name] = row.column;
    }
    // the models this one holds foreign keys to, so it can be dropped before them
    const references = allRows.filter((row) => row.type === "belongsTo").map((row) => parseFieldOptions(row.options).model);
    dropModels.push({ modelName, tableName: previousRow.table_name, fields, columns, references });
  }
  // With real foreign keys a table can't be dropped while another still points at it:
  // drop the referencing (child) tables first.
  const dropOrder = [];
  const remaining = [...dropModels];
  while (remaining.length > 0) {
    const names = new Set(remaining.map((m) => m.modelName));
    const next = remaining.findIndex((m) => !remaining.some((other) => other !== m && other.references.includes(m.modelName) && names.has(other.modelName)));
    dropOrder.push(...remaining.splice(next === -1 ? 0 : next, 1));
  }
  dropModels.splice(0, dropModels.length, ...dropOrder);

  // Field-level diff for every model that exists in both the previous
  // snapshot and the current registry (including rename targets).
  const modelsToCompare = [
    ...currentModelNames,
  ].filter((n) => previousModelNames.has(n) || renamedToNames.has(n));

  const fieldChanges = {};
  for (const modelName of modelsToCompare) {
    const model = modelRegistry.getModel(modelName);
    const sourceMetaName = identityRenameMap[modelName] ?? modelName;

    const previousFieldRows = await getColumnFieldsMeta(db, sourceMetaName);
    const previousFieldNames = new Set(previousFieldRows.map((r) => r.name));
    const currentFieldNames = new Set(Object.keys(model.fields));

    const removedFieldNames = [...previousFieldNames].filter((n) => !currentFieldNames.has(n));
    const addedFieldNames = [...currentFieldNames].filter((n) => !previousFieldNames.has(n));
    const modelFieldRenames = fieldRenames[modelName] ?? {};

    const renameFields = [];
    const dropFieldNames = [];
    for (const removedFieldName of removedFieldNames) {
      const target = modelFieldRenames[removedFieldName];
      if (target && currentFieldNames.has(target)) {
        const previousRow = previousFieldRows.find((r) => r.name === removedFieldName);
        renameFields.push({
          from: removedFieldName,
          to: target,
          fromColumn: previousRow.column,
          toColumn: model.columns[target],
        });
      } else {
        dropFieldNames.push(removedFieldName);
      }
    }
    const renamedToFieldNames = new Set(renameFields.map((r) => r.to));
    const addFields = addedFieldNames.filter((n) => !renamedToFieldNames.has(n));

    const possibleFieldRenames =
      dropFieldNames.length > 0 && addFields.length > 0
        ? { removed: dropFieldNames, added: addFields }
        : null;

    const dropFields = dropFieldNames.map((fieldName) => {
      const row = previousFieldRows.find((r) => r.name === fieldName);
      return { fieldName, columnName: row.column, field: parseFieldOptions(row.options) };
    });

    const columnRenames = [];
    const typeChanges = [];
    for (const row of previousFieldRows) {
      if (!currentFieldNames.has(row.name)) continue;
      const field = model.fields[row.name];
      const currentColumn = model.columns[row.name];
      if (currentColumn !== row.column) {
        columnRenames.push({ fieldName: row.name, fromColumn: row.column, toColumn: currentColumn });
      }
      if (field.type !== row.type) {
        typeChanges.push({ fieldName: row.name, from: row.type, to: field.type });
      }
    }

    const hasChanges =
      addFields.length ||
      dropFields.length ||
      renameFields.length ||
      columnRenames.length ||
      typeChanges.length;

    if (hasChanges) {
      fieldChanges[modelName] = {
        addFields,
        dropFields,
        renameFields,
        columnRenames,
        typeChanges,
        possibleFieldRenames,
      };
    }
  }

  return {
    createModels,
    dropModels,
    renameModels,
    possibleModelRenames,
    fieldChanges,
  };
}

function parseFieldOptions(options) {
  return typeof options === "string" ? JSON.parse(options) : options;
}
