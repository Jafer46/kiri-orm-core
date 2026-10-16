/**
 * Renders one JSON Schema object (as produced by schema-generator.js)
 * into a `@typedef` JSDoc comment block. Properties not in the
 * schema's `required` list are rendered with the `[name]` optional
 * syntax JSDoc/TypeScript's JSDoc-mode both recognize.
 *
 * @param {string} typeName
 * @param {object} schema - a JSON Schema object with `type: "object"`
 * @returns {string}
 */
export declare function jsonSchemaToJSDoc(typeName: string, schema: object): string;
/**
 * Generates all three `@typedef` blocks (Create/Update/Read) for one
 * model, concatenated into a single string ready to write to a `.js`
 * file for editor intellisense - no TypeScript compilation involved,
 * just JSDoc comments an editor's language server already understands.
 *
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @returns {string}
 */
export declare function generateJSDocForModel(model: import('../models/define-model.js').ModelDescriptor): string;
/**
 * Generates JSDoc typedefs for every model in a registry, concatenated
 * into one file-ready string.
 *
 * @param {import('../models/registry.js').ModelRegistry} modelRegistry
 * @returns {string}
 */
export declare function generateJSDocForRegistry(modelRegistry: import('../models/registry.js').ModelRegistry): string;
