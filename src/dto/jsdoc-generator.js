import { generateCreateSchema, generateUpdateSchema, generateReadSchema } from "./schema-generator.js";

const JSON_SCHEMA_TO_JSDOC_TYPE = {
  string: "string",
  integer: "number",
  number: "number",
  boolean: "boolean",
};

/**
 * Renders one JSON Schema property as a JSDoc type string. Enums
 * render as a string-literal union (`"draft"|"sent"|"paid"`) rather
 * than the generic `string`, since that's genuinely more useful for
 * editor autocomplete and is exactly the information a JSON Schema
 * `enum` already carries.
 *
 * @param {object} propertySchema
 * @returns {string}
 */
function jsdocType(propertySchema) {
  if (propertySchema.enum) {
    return propertySchema.enum.map((v) => JSON.stringify(v)).join("|");
  }
  if (propertySchema.type === "string" && propertySchema.format === "date") return "Date";
  if (propertySchema.type === "string" && propertySchema.format === "date-time") return "Date";
  return JSON_SCHEMA_TO_JSDOC_TYPE[propertySchema.type] ?? "*";
}

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
export function jsonSchemaToJSDoc(typeName, schema) {
  const requiredSet = new Set(schema.required ?? []);
  const lines = [`/**`, ` * @typedef {Object} ${typeName}`];

  for (const [propName, propSchema] of Object.entries(schema.properties)) {
    const isRequired = requiredSet.has(propName);
    const name = isRequired ? propName : `[${propName}]`;
    lines.push(` * @property {${jsdocType(propSchema)}} ${name}`);
  }

  lines.push(` */`);
  return lines.join("\n");
}

/**
 * Generates all three `@typedef` blocks (Create/Update/Read) for one
 * model, concatenated into a single string ready to write to a `.js`
 * file for editor intellisense - no TypeScript compilation involved,
 * just JSDoc comments an editor's language server already understands.
 *
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @returns {string}
 */
export function generateJSDocForModel(model) {
  const name = model.name.charAt(0).toUpperCase() + model.name.slice(1);
  return [
    jsonSchemaToJSDoc(`Create${name}`, generateCreateSchema(model)),
    jsonSchemaToJSDoc(`Update${name}`, generateUpdateSchema(model)),
    jsonSchemaToJSDoc(`Read${name}`, generateReadSchema(model)),
  ].join("\n\n");
}

/**
 * Generates JSDoc typedefs for every model in a registry, concatenated
 * into one file-ready string.
 *
 * @param {import('../models/registry.js').ModelRegistry} modelRegistry
 * @returns {string}
 */
export function generateJSDocForRegistry(modelRegistry) {
  modelRegistry.assertResolved();
  return modelRegistry
    .listModels()
    .map((modelName) => generateJSDocForModel(modelRegistry.getModel(modelName)))
    .join("\n\n");
}
