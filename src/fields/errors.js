/**
 * Thrown by castValue() when a value cannot be coerced into a field's
 * declared type at all (e.g. "abc" cast as integer). This is distinct
 * from validation failures (wrong length, out of range, etc.), which
 * are reported as a list of error strings from validateValue() instead
 * of thrown, since a caller (e.g. a future DTO layer) will often want
 * to collect *all* validation problems for a record at once rather than
 * stopping at the first one.
 */
export class CastError extends TypeError {
  /**
   * @param {string} message
   * @param {{ fieldType?: string, value?: unknown }} [details]
   */
  constructor(message, details = {}) {
    super(message);
    this.name = "CastError";
    this.fieldType = details.fieldType;
    this.value = details.value;
  }
}

/**
 * Thrown by defineField() when a field descriptor itself is malformed
 * (unknown type, missing required type-specific option, bad option
 * value). This is a developer-time error about the schema, not a
 * runtime error about a piece of data.
 */
export class InvalidFieldDefinitionError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidFieldDefinitionError";
  }
}
