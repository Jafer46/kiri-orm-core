import { InvalidFieldDefinitionError } from "./errors.js";
import { defaultFieldTypeRegistry } from "./default-registry.js";

/**
 * @typedef {Object} FieldDescriptor
 * @property {string} type
 * @property {boolean} required
 * @property {boolean} unique
 * @property {boolean} index
 * @property {unknown|(() => unknown)} [default]
 * @property {...unknown} [typeSpecificOptions]
 */

/**
 * Defines a single field descriptor: a plain, serializable object
 * describing a piece of data (its type, constraints, and default).
 * This is the runtime "type system" the project uses instead of
 * TypeScript - the object itself is both the schema and the contract
 * that validateValue()/castValue() enforce at runtime.
 *
 * Fields are frozen shallowly so accidental in-place mutation (e.g.
 * `field.required = true` after the fact) fails loudly instead of
 * silently drifting from what was registered.
 *
 * @param {Partial<FieldDescriptor> & { type: string }} options
 * @param {import('./registry.js').FieldTypeRegistry} [registry]
 * @returns {Readonly<FieldDescriptor>}
 */
export function defineField(options, registry = defaultFieldTypeRegistry) {
  if (!options || typeof options !== "object") {
    throw new InvalidFieldDefinitionError("Field definition must be an object");
  }
  if (typeof options.type !== "string" || !options.type) {
    throw new InvalidFieldDefinitionError("Field definition requires a `type` string");
  }

  if (options.search !== undefined || options.depends !== undefined) {
    throw new InvalidFieldDefinitionError(
      "`search` and `depends` only apply to computed fields. Add a `compute` function to make this one computed, or remove them."
    );
  }

  // Throws a descriptive error (with the list of known types) if
  // `options.type` isn't registered.
  const typeDef = registry.get(options.type);

  const field = {
    required: false,
    unique: false,
    index: false,
    ...options,
  };

  if (typeof typeDef.validateOptions === "function") {
    const errors = typeDef.validateOptions(field);
    if (errors.length > 0) {
      throw new InvalidFieldDefinitionError(
        `Invalid options for field type "${options.type}": ${errors.join("; ")}`
      );
    }
  }

  return Object.freeze(field);
}
