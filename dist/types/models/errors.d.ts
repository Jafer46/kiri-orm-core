/**
 * Thrown by defineModel() when a model descriptor itself is malformed:
 * missing name, no fields, an invalid field definition, or a naming
 * collision between two fields' resolved column names within the same
 * model. A developer-time error about the schema, not runtime data.
 */
export declare class InvalidModelDefinitionError extends Error {
    constructor(message: any);
}
/**
 * Thrown by ModelRegistry#register() when a model name or resolved
 * table name is already taken by a previously registered model.
 */
export declare class ModelConflictError extends Error {
    constructor(message: any);
}
/**
 * Thrown by ModelRegistry#getModel()/#getFields() when the requested
 * model name isn't registered.
 */
export declare class UnknownModelError extends Error {
    constructor(message: any);
}
