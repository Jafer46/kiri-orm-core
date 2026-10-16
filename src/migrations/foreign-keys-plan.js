import { planCreation } from "../schema/foreign-keys.js";
import { foreignKeysOf } from "../relations/foreign-keys.js";

/**
 * The foreign keys a migration plan has to create, worked out once so the in-memory
 * migration (generate.js) and the rendered file (render.js) agree:
 *
 *   creation  new models in dependency order, with the keys that go inside each CREATE TABLE
 *             (`inline`) and the few that can't (a cycle) added afterwards (`deferred`)
 *   added     per existing model, the keys belonging to columns this migration adds
 *
 * Keys on columns that already exist are not part of a plan: the diff only sees fields.
 * (`sync({ addMissingForeignKeys: true })` is the way to add those.)
 *
 * @param {import('./diff.js').DiffPlan} plan
 * @param {import('../models/registry.js').ModelRegistry} modelRegistry
 */
export function planMigrationForeignKeys(plan, modelRegistry) {
  const created = plan.createModels.map((name) => modelRegistry.getModel(name));
  const creation = planCreation(created, (model) => foreignKeysOf(modelRegistry, model));

  const added = {};
  for (const [modelName, changes] of Object.entries(plan.fieldChanges)) {
    const model = modelRegistry.getModel(modelName);
    const columns = new Set(changes.addFields.map((fieldName) => model.columns[fieldName]));
    const keys = foreignKeysOf(modelRegistry, model).filter((fk) => columns.has(fk.column));
    if (keys.length > 0) added[modelName] = keys;
  }
  return { creation, added };
}

const json = (value) => JSON.stringify(value);

/** The source line for one foreign key, as written into a rendered migration file. */
export const renderForeignKey = (fk) =>
  `table.foreign(${json(fk.column)}).references(${json(fk.refColumn)}).inTable(${json(fk.refTable)}).onDelete(${json(fk.onDelete)});`;
