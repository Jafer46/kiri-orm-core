import { InvalidRelationDefinitionError } from "./errors.js";

const RELATION_TYPES = ["hasOne", "hasMany", "belongsTo", "belongsToMany"];

const ON_DELETE_ACTIONS = ["restrict", "cascade", "setNull"];

/**
 * @typedef {Object} RelationDescriptor
 * @property {"hasOne"|"hasMany"|"belongsTo"|"belongsToMany"} type
 * @property {string} model - the related model's name
 * @property {string} foreignKey - see per-type notes below
 * @property {string} [through] - belongsToMany only: the pivot table name
 * @property {string} [otherKey] - belongsToMany only: the pivot column referencing the related model
 * @property {string} localKey - defaults to the referenced model's primary key (see resolveLocalKey()); see per-type notes below
 * @property {"restrict"|"cascade"|"setNull"} [onDelete] - belongsTo only; see define-relation.js's docstring
 * @property {boolean} [constraint] - belongsTo only; `false` = no database foreign key (default: true)
 */

/**
 * Defines one relation. Direction matters and is easy to get backwards,
 * so it's spelled out explicitly here:
 *
 * - **belongsTo**: the foreign key lives on THIS model.
 *   `foreignKey` = a field name on this model (e.g. "invoiceId").
 *   `localKey` = the field on the RELATED model it points to (default "id").
 *   `onDelete` says what happens to THIS model's rows when the row they
 *   point at is deleted - see "Deleting through a relation" below.
 *
 * - **hasOne** / **hasMany**: the foreign key lives on the RELATED model.
 *   `foreignKey` = a field name on the related model (e.g. "invoiceId").
 *   `localKey` = the field on THIS model it points to (default "id").
 *
 * - **belongsToMany**: a pivot table holds both sides.
 *   `through` = the pivot table name (auto-created by schema sync if missing).
 *   `foreignKey` = the pivot column referencing THIS model's `localKey` (default "id").
 *   `otherKey` = the pivot column referencing the related model's `id`.
 *
 * Relation *targets* are intentionally not validated here (see
 * RelationError's docstring) - only the descriptor's own shape is
 * checked at definition time.
 *
 * ## Deleting through a relation
 *
 * Only `belongsTo` carries `onDelete` - the side that holds the foreign
 * key is the side that has something to say about losing what it points
 * to, the same reasoning Odoo's Many2one `ondelete` uses (a One2many is
 * just the inverse view of the same column and carries no setting of its
 * own). Declare the `belongsTo` side of a relationship - even one you'd
 * otherwise only query from the `hasMany` side - if you want deleting the
 * parent to be handled rather than leaving an orphaned foreign key behind.
 *
 * Three actions, matching Odoo's own three:
 *   - `"restrict"` (default when the foreign key field is `required`):
 *     refuses the delete if any referencing row exists.
 *   - `"setNull"` (default when the foreign key field is NOT required):
 *     the referencing rows' foreign key is set to `null`.
 *   - `"cascade"`: the referencing rows are deleted too - recursively,
 *     through their own `belongsTo` relations in turn.
 *
 * Setting `onDelete: "setNull"` explicitly on a `required` foreign key is
 * rejected (a `required` column can never legally hold `null`) - not here,
 * where the related model isn't known yet, but the first time the relation
 * is actually used for a delete (see relations/cascade-delete.js).
 *
 * These are enforced by the DATABASE: `sync()` (and generated migrations) create a real
 * `FOREIGN KEY ... ON DELETE RESTRICT | SET NULL | CASCADE` constraint for every `belongsTo`,
 * so a delete is one statement and the rules hold for every writer, not just this ORM.
 * Set `constraint: false` on a `belongsTo` to opt out (a legacy table, a key into another
 * database, ...): no constraint is created, and the ORM applies `onDelete` itself in
 * JavaScript instead - several statements per delete, for that relation only.
 *
 * A `belongsToMany` relation's pivot rows are always cleaned up when
 * either side is deleted (the pivot table's foreign keys cascade) - there's no `onDelete` to set for it, because an
 * orphaned pivot row is never something you'd want kept.
 *
 * @param {Object} options
 * @returns {Readonly<RelationDescriptor>}
 */
export function defineRelation(options) {
  if (!options || typeof options !== "object") {
    throw new InvalidRelationDefinitionError("Relation definition must be an object");
  }
  if (!RELATION_TYPES.includes(options.type)) {
    throw new InvalidRelationDefinitionError(
      `Relation \`type\` must be one of: ${RELATION_TYPES.join(", ")} (got "${options.type}")`
    );
  }
  if (typeof options.model !== "string" || !options.model) {
    throw new InvalidRelationDefinitionError(`Relation of type "${options.type}" requires a \`model\` name`);
  }

  if (options.type === "belongsToMany") {
    for (const key of ["through", "foreignKey", "otherKey"]) {
      if (typeof options[key] !== "string" || !options[key]) {
        throw new InvalidRelationDefinitionError(
          `belongsToMany relation to "${options.model}" requires a non-empty \`${key}\``
        );
      }
    }
  } else if (typeof options.foreignKey !== "string" || !options.foreignKey) {
    throw new InvalidRelationDefinitionError(
      `${options.type} relation to "${options.model}" requires a non-empty \`foreignKey\``
    );
  }

  if (options.onDelete !== undefined) {
    if (options.type !== "belongsTo") {
      throw new InvalidRelationDefinitionError(
        `\`onDelete\` only applies to a "belongsTo" relation (it's the side with the foreign key) - ` +
          `"${options.type}" relation to "${options.model}" can't set it.`
      );
    }
    if (!ON_DELETE_ACTIONS.includes(options.onDelete)) {
      throw new InvalidRelationDefinitionError(
        `\`onDelete\` must be one of: ${ON_DELETE_ACTIONS.join(", ")} (got "${options.onDelete}")`
      );
    }
  }

  if (options.constraint !== undefined) {
    if (options.type !== "belongsTo") {
      throw new InvalidRelationDefinitionError(
        `\`constraint\` only applies to a "belongsTo" relation (it's the side with the foreign key) - ` +
          `"${options.type}" relation to "${options.model}" can't set it.`
      );
    }
    if (typeof options.constraint !== "boolean") {
      throw new InvalidRelationDefinitionError(`\`constraint\` must be true or false (got ${JSON.stringify(options.constraint)})`);
    }
  }

  return Object.freeze({
    type: options.type,
    model: options.model,
    foreignKey: options.foreignKey,
    through: options.through,
    otherKey: options.otherKey,
    localKey: options.localKey ?? "id",
    // True when `localKey` was not given: it then means "the primary key of the model it
    // refers to", which is only known once the models are (see relations/keys.js).
    localKeyIsDefault: options.localKey === undefined,
    onDelete: options.onDelete,
    constraint: options.constraint,
  });
}

export { RELATION_TYPES, ON_DELETE_ACTIONS };
