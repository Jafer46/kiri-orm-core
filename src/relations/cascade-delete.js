import { RelationError } from "./errors.js";
import { ON_DELETE_ACTIONS } from "./define-relation.js";
import { resolveOnDelete } from "./foreign-keys.js";
import { primaryKeyOf } from "../models/primary-key.js";

// Since foreign keys became real database constraints (see foreign-keys.js), the database applies
// onDelete itself and a delete is a single statement. Everything in this file is therefore only
// the FALLBACK for the one case a constraint can't cover: a `belongsTo` that opted out with
// `constraint: false`. Models nothing opted-out points at never reach it.

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/**
 * Every `belongsTo` relation with `constraint: false`, on any model in the registry, that
 * points AT `modelName` - the relationships the database can't protect, so the ORM must.
 *
 * @returns {Array<{ childModel: import('../models/define-model.js').ModelDescriptor, relation: import('./define-relation.js').RelationDescriptor }>}
 */
function findIncomingBelongsTo(modelRegistry, modelName) {
  const found = [];
  for (const name of modelRegistry.listModels()) {
    const childModel = modelRegistry.getModel(name);
    for (const relation of Object.values(childModel.relations ?? {})) {
      if (relation.type === "belongsTo" && relation.constraint === false && relation.model === modelName) {
        found.push({ childModel, relation });
      }
    }
  }
  return found;
}

/**
 * Whether deleting a row of `modelName` needs anything beyond a plain `DELETE ... WHERE ...`
 * - i.e. whether a `constraint: false` relation points at it. Anything else is handled by the
 * database's own foreign keys. Pure registry inspection, no query.
 *
 * @param {import('../models/registry.js').ModelRegistry} modelRegistry
 * @param {string} modelName
 * @returns {boolean}
 */
export function hasIncomingRelations(modelRegistry, modelName) {
  if (!modelRegistry) return false;
  return findIncomingBelongsTo(modelRegistry, modelName).length > 0;
}

/**
 * Deletes the rows of `model` matching `ids`, honoring the `onDelete` setting of every
 * `constraint: false` relation that points at it.
 * Recurses for `"cascade"`, so a multi-level chain (invoice -> line item
 * -> discount) is deleted bottom-up correctly.
 *
 * Every `"restrict"` relation across the WHOLE operation is checked
 * before anything is deleted or nulled, so a refusal never leaves a
 * partial cascade behind - see the transaction wrapping in
 * `deleteRowsWithCascade()` below, which is the actual entry point.
 *
 * @param {import('knex').Knex} db - already a transaction
 * @param {import('../models/registry.js').ModelRegistry} modelRegistry
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {Array<number|string>} ids
 * @returns {Promise<number>} rows of `model` actually deleted
 */
async function cascadeDelete(db, modelRegistry, model, ids) {
  if (ids.length === 0) return 0;

  const incoming = findIncomingBelongsTo(modelRegistry, model.name).map(({ childModel, relation }) => ({
    childModel,
    relation,
    action: resolveOnDelete(childModel, relation),
  }));

  // Every restrict check happens before any mutation - a refusal must
  // never leave setNull/cascade partially applied for an earlier relation.
  for (const { childModel, relation, action } of incoming) {
    if (action !== "restrict") continue;
    const column = childModel.columns[relation.foreignKey];
    const blocking = await db(childModel.tableName).whereIn(column, ids).first(column);
    if (blocking) {
      throw new RelationError(
        `Can't delete from "${model.name}": "${childModel.name}.${relation.foreignKey}" (belongsTo, onDelete: "restrict") ` +
          `still has at least one row pointing at ${JSON.stringify(ids.length === 1 ? ids[0] : ids)}.`
      );
    }
  }

  for (const { childModel, relation, action } of incoming) {
    const column = childModel.columns[relation.foreignKey];
    if (action === "setNull") {
      await db(childModel.tableName).whereIn(column, ids).update({ [column]: null });
    } else if (action === "cascade") {
      const childKey = primaryKeyOf(childModel);
      if (childKey === null) {
        throw new RelationError(
          `"${childModel.name}.${relation.foreignKey}" (belongsTo "${relation.model}", onDelete: "cascade") can't cascade: ` +
            `related model "${childModel.name}" has no primary key.`
        );
      }
      const childIdColumn = childModel.columns[childKey];
      const rows = await db(childModel.tableName).whereIn(column, ids).select(childIdColumn);
      const childIds = rows.map((row) => row[childIdColumn]);
      await cascadeDelete(db, modelRegistry, childModel, childIds);
    }
  }

  return db(model.tableName).whereIn(model.columns[primaryKeyOf(model)], ids).delete();
}

/**
 * Entry point used by Repository#delete(): resolves `where` to actual
 * ids, then deletes them with full cascade/restrict/setNull handling,
 * in one transaction (joining `options.trx` if given, opening one
 * otherwise) so a `"restrict"` refusal or a mid-cascade failure leaves
 * nothing changed.
 *
 * @param {import('knex').Knex} db
 * @param {import('../models/registry.js').ModelRegistry} modelRegistry
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {(qb: import('knex').Knex.QueryBuilder) => void} where - as built by resolveWhere()
 * @param {{ trx?: import('knex').Knex.Transaction }} [options]
 * @returns {Promise<number>} rows of `model` deleted
 */
export async function deleteRowsWithCascade(db, modelRegistry, model, where, options = {}) {
  const key = primaryKeyOf(model);
  if (key === null) {
    throw new RelationError(
      `Can't apply onDelete handling for "${model.name}": it has no primary key. ` +
        `Remove the relations that point at it, or declare a primary key.`
    );
  }
  const baseDb = options.trx ?? db;
  const idColumn = model.columns[key];
  const ids = (await baseDb(model.tableName).where(where).select(idColumn)).map((row) => row[idColumn]);
  if (ids.length === 0) return 0;

  if (baseDb.isTransaction) return cascadeDelete(baseDb, modelRegistry, model, ids);
  return baseDb.transaction((trx) => cascadeDelete(trx, modelRegistry, model, ids));
}

export { ON_DELETE_ACTIONS };
