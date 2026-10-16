import { InvalidFieldDefinitionError } from "./errors.js";

/**
 * @typedef {Object} FieldTypeDefinition
 * @property {string} name
 * @property {(field: object) => string[]} [validateOptions]
 *   Validates the type-specific options on a field descriptor at
 *   definition time (e.g. enum requires a non-empty `values` array).
 *   Returns an array of error strings; empty array means valid.
 * @property {(field: object, value: unknown) => string[]} validate
 *   Validates a runtime value against the field (assumes value is
 *   already non-null/undefined - required/null handling happens
 *   before this is called). Returns an array of error strings.
 * @property {(field: object, value: unknown) => unknown} cast
 *   Coerces a runtime value into the field's canonical JS
 *   representation, or throws CastError if coercion isn't possible.
 */

/**
 * Holds field type definitions (char, integer, etc.) keyed by name.
 * Kept as a class rather than a bare object so multiple independent
 * registries can exist later (useful for plugin isolation or testing)
 * without global mutation.
 */
export class FieldTypeRegistry {
  #types = new Map();

  /**
   * @param {FieldTypeDefinition} definition
   */
  register(definition) {
    if (!definition || typeof definition.name !== "string" || !definition.name) {
      throw new InvalidFieldDefinitionError(
        "Field type definition must have a non-empty string `name`"
      );
    }
    if (typeof definition.validate !== "function") {
      throw new InvalidFieldDefinitionError(
        `Field type "${definition.name}" must implement validate(field, value)`
      );
    }
    if (typeof definition.cast !== "function") {
      throw new InvalidFieldDefinitionError(
        `Field type "${definition.name}" must implement cast(field, value)`
      );
    }
    this.#types.set(definition.name, definition);
    return this;
  }

  /**
   * @param {string} name
   * @returns {FieldTypeDefinition}
   */
  get(name) {
    const def = this.#types.get(name);
    if (!def) {
      throw new InvalidFieldDefinitionError(
        `Unknown field type "${name}". Registered types: ${this.names().join(", ") || "(none)"}`
      );
    }
    return def;
  }

  has(name) {
    return this.#types.has(name);
  }

  names() {
    return [...this.#types.keys()];
  }
}
