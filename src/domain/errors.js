/**
 * Thrown when a domain array is malformed: not an array, a leaf that
 * isn't a 3-element [field, operator, value] tuple, an unknown
 * operator, or a prefix operator ('&', '|', '!') without enough
 * following expressions to consume. A structural problem with the
 * domain itself, independent of which model it's evaluated against.
 */
export class DomainSyntaxError extends Error {
  constructor(message) {
    super(message);
    this.name = "DomainSyntaxError";
  }
}

/**
 * Thrown when a structurally valid domain references something that
 * doesn't exist on the model it's compiled against - an unknown field
 * name (the "catch typos before hitting the DB" goal), or a value
 * shape that doesn't fit the operator (e.g. a non-array value for
 * "in").
 */
export class DomainValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "DomainValidationError";
  }
}
