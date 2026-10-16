export type FieldTypeDefinition = {
    name: string;
    /**
     * Validates the type-specific options on a field descriptor at
     * definition time (e.g. enum requires a non-empty `values` array).
     * Returns an array of error strings; empty array means valid.
     */
    validateOptions?: (field: object) => string[];
    /**
     *   Validates a runtime value against the field (assumes value is
     *   already non-null/undefined - required/null handling happens
     *   before this is called). Returns an array of error strings.
     */
    validate: (field: object, value: unknown) => string[];
    /**
     *   Coerces a runtime value into the field's canonical JS
     *   representation, or throws CastError if coercion isn't possible.
     */
    cast: (field: object, value: unknown) => unknown;
};
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
export declare class FieldTypeRegistry {
    #private;
    /**
     * @param {FieldTypeDefinition} definition
     */
    register(definition: FieldTypeDefinition): this;
    /**
     * @param {string} name
     * @returns {FieldTypeDefinition}
     */
    get(name: string): FieldTypeDefinition;
    has(name: any): boolean;
    names(): any[];
}
