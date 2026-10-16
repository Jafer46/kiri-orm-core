import { primaryKeyOf } from "../models/primary-key.js";

/**
 * Which field a relation's `localKey` means, once defaults are resolved.
 *
 * `localKey` defaults to "the primary key of the model it refers to":
 *   - hasOne / hasMany / belongsToMany: the field on THIS (owner) model
 *   - belongsTo: the field on the RELATED model
 * A `localKey` the relation set explicitly is always used as written.
 *
 * @param {import('./define-relation.js').RelationDescriptor} relation
 * @param {object} ownerModel - the model the relation is defined on
 * @param {object} [relatedModel] - required for belongsTo when localKey is defaulted
 * @returns {string}
 */
export function resolveLocalKey(relation, ownerModel, relatedModel) {
  if (!relation.localKeyIsDefault) return relation.localKey;
  const model = relation.type === "belongsTo" ? relatedModel : ownerModel;
  return (model && primaryKeyOf(model)) ?? relation.localKey;
}
