/**
 * Converts one field descriptor (Phase 1) into a JSON Schema
 * fragment. Pure data transformation - no DB, no compiler, just the
 * field object that already exists at runtime. This is the whole
 * point of not depending on TypeScript's type system for this: the
 * schema IS the source of truth already, so generating a JSON Schema
 * from it is just reading properties off an object.
 *
 * @param {import('../fields/define-field.js').FieldDescriptor} field
 * @returns {object}
 */
export declare function fieldToJsonSchema(field: import('../fields/define-field.js').FieldDescriptor): object;
