import { generateDTOSchemas, generateDTOSchemasForRegistry } from "../dto/schema-generator.js";
import { generateJSDocForRegistry } from "../dto/jsdoc-generator.js";
import { state } from "./state.js";

/**
 * DTO schemas (create/update/read) for one model registered via
 * `createModel()`, using the default registry - the Mongoose-style
 * API's equivalent of calling `generateDTOSchemas(model)` directly
 * with an explicit `ModelRegistry`.
 *
 * @param {string} modelName
 * @returns {{ create: object, update: object, read: object }}
 */
export function generateModelDTOs(modelName) {
  return generateDTOSchemas(state.registry.getModel(modelName));
}

/**
 * DTO schemas for every model registered via `createModel()`.
 *
 * @returns {Record<string, { create: object, update: object, read: object }>}
 */
export function generateAllModelDTOs() {
  return generateDTOSchemasForRegistry(state.registry);
}

/**
 * JSDoc `@typedef` blocks for every model registered via
 * `createModel()`, concatenated into one file-ready string.
 *
 * @returns {string}
 */
export function generateModelJSDoc() {
  return generateJSDocForRegistry(state.registry);
}
