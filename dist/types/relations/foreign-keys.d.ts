export type ForeignKeySpec = {
    /**
     * - the column holding the key, in the table that owns it
     */
    column: string;
    /**
     * - the table it points at
     */
    refTable: string;
    /**
     * - the column it points at (primary or unique)
     */
    refColumn: string;
    onDelete: "RESTRICT" | "CASCADE" | "SET NULL";
    /**
     * - the `belongsTo` relation it comes from (absent for pivot tables)
     */
    relation?: string;
    /**
     * - the model it points at (absent for pivot tables)
     */
    refModel?: string;
};
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
export declare function resolveOnDelete(childModel: object, relation: import('./define-relation.js').RelationDescriptor): "restrict" | "cascade" | "setNull";
/** A `belongsTo` is backed by a real database constraint unless it opted out with `constraint: false`. */
export declare const hasDatabaseConstraint: (relation: any) => boolean;
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
export declare function foreignKeysOf(modelRegistry: import('../models/registry.js').ModelRegistry, model: object): ForeignKeySpec[];
/**
 * The two foreign keys of a `belongsToMany` pivot table. Both cascade: an orphaned pivot row
 * is never something to keep, so deleting either side removes its associations.
 *
 * @param {import('../models/registry.js').ModelRegistry} modelRegistry
 * @param {object} ownerModel - the model the relation is declared on
 * @param {import('./define-relation.js').RelationDescriptor} relation
 * @returns {ForeignKeySpec[]}
 */
export declare function pivotForeignKeysOf(modelRegistry: import('../models/registry.js').ModelRegistry, ownerModel: object, relation: import('./define-relation.js').RelationDescriptor): ForeignKeySpec[];
/**
 * Whether a driver error is a foreign key violation: Postgres code 23503, or SQLite's
 * SQLITE_CONSTRAINT_FOREIGNKEY (older drivers only say so in the message).
 */
export declare function isForeignKeyViolation(error: any): boolean;
/**
 * Turns the database's refusal to delete a still-referenced row into the ORM's own
 * `RelationError`, keeping the driver error as `cause`. Anything else passes through.
 */
export declare function translateDeleteError(error: any, modelName: any): any;
