/**
 * Thrown by defineModel() when a model descriptor itself is malformed:
 * missing name, no fields, an invalid field definition, or a naming
 * collision between two fields' resolved column names within the same
 * model. A developer-time error about the schema, not runtime data.
 */
export class InvalidModelDefinitionError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidModelDefinitionError";
  }
}

/**
 * Thrown by ModelRegistry#register() when a model name or resolved
 * table name is already taken by a previously registered model.
 */
export class ModelConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "ModelConflictError";
  }
}

/**
 * Thrown by ModelRegistry#getModel()/#getFields() when the requested
 * model name isn't registered.
 */
export class UnknownModelError extends Error {
  constructor(message) {
    super(message);
    this.name = "UnknownModelError";
  }
}
