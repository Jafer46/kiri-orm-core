/**
 * Thrown by defineRelation() when a relation descriptor is malformed:
 * unknown type, missing `model`, or missing the type-specific keys
 * (`foreignKey` for hasOne/hasMany/belongsTo; `through`/`foreignKey`/
 * `otherKey` for belongsToMany). A developer-time error about the
 * schema, same spirit as InvalidFieldDefinitionError.
 */
export declare class InvalidRelationDefinitionError extends Error {
    constructor(message: any);
}
/**
 * Thrown at query time (eager or lazy load) when a relation name
 * isn't defined on the model, or when its target model isn't
 * registered. Relation *targets* can't be validated at definition
 * time - two models can legitimately reference each other, so
 * whichever is defined first would otherwise fail validation against
 * a model that doesn't exist yet.
 */
export declare class RelationError extends Error {
    constructor(message: any, options: any);
}
