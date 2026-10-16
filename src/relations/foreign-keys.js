import { RelationError } from "./errors.js";
import { resolveLocalKey } from "./keys.js";
import { primaryKeyOf } from "../models/primary-key.js";

/** `onDelete` action -> the SQL referential action the database enforces. */
const SQL_ACTION = { restrict: "RESTRICT", cascade: "CASCADE", setNull: "SET NULL" };

/**
 * @typedef {Object} ForeignKeySpec
 * @property {string} column - the column holding the key, in the table that owns it
 * @property {string} refTable - the table it points at
 * @property {string} refColumn - the column it points at (primary or unique)
 * @property {"RESTRICT"|"CASCADE"|"SET NULL"} onDelete
 * @property {string} [relation] - the `belongsTo` relation it comes from (absent for pivot tables)
 * @property {string} [refModel] - the model it points at (absent for pivot tables)
 */

/**
 * The effective on-delete action for one `belongsTo` relation: whatever it declared
 * explicitly, or a default from whether its foreign key field can hold `null`
 * (required -> "restrict", otherwise "setNull").
 *
 * @param {object} childModel - the model that owns the foreign key
 * @param {import('./define-relation.js').RelationDescriptor} relation
 * @returns {"restrict"|"cascade"|"setNull"}
 * @throws {RelationError} `onDelete: "setNull"` was set explicitly on a `required` foreign key field
 */
export function resolveOnDelete(childModel, relation) {
  const required = childModel.fields[relation.foreignKey]?.required === true;
  if (relation.onDelete !== undefined) {
    if (relation.onDelete === "setNull" && required) {
      throw new RelationError(
        `"${childModel.name}.${relation.foreignKey}" (belongsTo "${relation.model}") can't use onDelete: "setNull" - ` +
          `the field is \`required\`, so it can never hold null. Use "restrict" or "cascade" instead.`
      );
    }
    return relation.onDelete;
  }
  return required ? "restrict" : "setNull";
}

/** A `belongsTo` is backed by a real database constraint unless it opted out with `constraint: false`. */
export const hasDatabaseConstraint = (relation) => relation.type === "belongsTo" && relation.constraint !== false;

/**
 * The foreign keys a model's table should carry: one per `belongsTo` relation (that hasn't
 * opted out with `constraint: false`) whose target is registered and whose referenced field is
 * a primary key or `unique` - the only things a database lets a foreign key point at.
 *
 * @param {import('../models/registry.js').ModelRegistry} modelRegistry
 * @param {object} model
 * @returns {ForeignKeySpec[]}
 * @throws {RelationError} an explicit `onDelete: "setNull"` on a `required` foreign key field
 */
export function foreignKeysOf(modelRegistry, model) {
  const specs = [];
  const registered = new Set(modelRegistry.listModels());
  for (const [relationName, relation] of Object.entries(model.relations ?? {})) {
    if (!hasDatabaseConstraint(relation)) continue;
    const column = model.columns[relation.foreignKey];
    if (column === undefined || !registered.has(relation.model)) continue;

    const target = modelRegistry.getModel(relation.model);
    const refKey = resolveLocalKey(relation, model, target);
    const refField = target.fields[refKey];
    if (!refField || !(refKey === primaryKeyOf(target) || refField.unique === true)) continue;

    specs.push({
      relation: relationName,
      column,
      refModel: target.name,
      refTable: target.tableName,
      refColumn: target.columns[refKey],
      onDelete: SQL_ACTION[resolveOnDelete(model, relation)],
    });
  }
  return specs;
}

/**
 * The two foreign keys of a `belongsToMany` pivot table. Both cascade: an orphaned pivot row
 * is never something to keep, so deleting either side removes its associations.
 *
 * @param {import('../models/registry.js').ModelRegistry} modelRegistry
 * @param {object} ownerModel - the model the relation is declared on
 * @param {import('./define-relation.js').RelationDescriptor} relation
 * @returns {ForeignKeySpec[]}
 */
export function pivotForeignKeysOf(modelRegistry, ownerModel, relation) {
  const specs = [];
  const ownerKey = resolveLocalKey(relation, ownerModel);
  if (ownerModel.columns[ownerKey]) {
    specs.push({ column: relation.foreignKey, refModel: ownerModel.name, refTable: ownerModel.tableName, refColumn: ownerModel.columns[ownerKey], onDelete: "CASCADE" });
  }
  if (modelRegistry.listModels().includes(relation.model)) {
    const related = modelRegistry.getModel(relation.model);
    const relatedKey = primaryKeyOf(related);
    if (relatedKey !== null) {
      specs.push({ column: relation.otherKey, refModel: related.name, refTable: related.tableName, refColumn: related.columns[relatedKey], onDelete: "CASCADE" });
    }
  }
  return specs;
}

/**
 * Whether a driver error is a foreign key violation: Postgres code 23503, or SQLite's
 * SQLITE_CONSTRAINT_FOREIGNKEY (older drivers only say so in the message).
 */
export function isForeignKeyViolation(error) {
  return error?.code === "23503" || error?.code === "SQLITE_CONSTRAINT_FOREIGNKEY" || /FOREIGN KEY constraint failed/i.test(error?.message ?? "");
}

/**
 * Turns the database's refusal to delete a still-referenced row into the ORM's own
 * `RelationError`, keeping the driver error as `cause`. Anything else passes through.
 */
export function translateDeleteError(error, modelName) {
  if (!isForeignKeyViolation(error)) return error;
  const detail = error.detail ? ` (${error.detail})` : "";
  return new RelationError(
    `Can't delete from "${modelName}": other rows still reference it through a foreign key with onDelete: "restrict"${detail}.`,
    { cause: error }
  );
}
