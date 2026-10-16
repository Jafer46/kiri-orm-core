/**
 * Thrown by Repository#create()/#update() when field validation fails,
 * or when the caller references a field name that isn't on the model
 * (a filter key, a write key, etc.) - both are surfaced through the
 * same `fieldErrors` shape so a caller only needs to handle one error
 * type to report every kind of "your data/filter was wrong" problem.
 */
export class ValidationError extends Error {
  /**
   * @param {string} modelName
   * @param {Record<string, string[]>} fieldErrors
   */
  constructor(modelName, fieldErrors) {
    const summary = Object.entries(fieldErrors)
      .map(([field, errors]) => `${field}: ${errors.join(", ")}`)
      .join("; ");
    super(`Validation failed for model "${modelName}": ${summary}`);
    this.name = "ValidationError";
    this.modelName = modelName;
    this.fieldErrors = fieldErrors;
  }
}
