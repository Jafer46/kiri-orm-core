export type FieldDescriptor = {
    type: string;
    required: boolean;
    unique: boolean;
    index: boolean;
    default?: unknown | (() => unknown);
    typeSpecificOptions?: unknown[];
};
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
export declare function defineField(options: Partial<FieldDescriptor> & {
    type: string;
}, registry?: import('./registry.js').FieldTypeRegistry): Readonly<FieldDescriptor>;
