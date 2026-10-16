import { fieldToJsonSchema } from "./field-schema.js";

/**
 * Two optional, DTO-generation-only conventions read off a field
 * descriptor - neither is used anywhere else in this ORM, they exist
 * purely for this module to consume:
 *
 * - `expose: false` - excluded from the READ dto (e.g. a password
 *   hash: fine to write, never fine to hand back in an API response).
 * - `writable: false` - excluded from CREATE and UPDATE dtos (e.g. a
 *   server-managed `createdAt`: fine to read, never something a
 *   client should be sending).
 *
 * Both default to `true` (included) when not set, so existing models
 * with neither flag generate exactly the DTOs you'd expect from their
 * fields as-is - opting a field OUT is always explicit.
 */

function isExposed(field) {
  return field.expose !== false;
}

function isWritable(field) {
  return field.writable !== false;
}

/**
 * The `create` DTO: every writable field except an automatically-assigned
 * primary key (integer autoincrement or generated uuid - see
 * fields/auto-id.js). A primary key that ISN'T auto-assigned (e.g. a
 * client-supplied code) is a normal writable field and appears here like
 * any other. A field is REQUIRED in this schema only if it's `required:
 * true` AND has no `default` - a required field with a default is optional
 * to supply, matching exactly how `prepareWrite()`'s create semantics
 * already treat it (an omitted field with a default gets filled in, not
 * rejected).
 *
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @returns {object} JSON Schema
 */
export function generateCreateSchema(model) {
  const properties = {};
  const required = [];

  for (const [fieldName, field] of Object.entries(model.fields)) {
    if (fieldName === model.primaryKey && field.autoId) continue;
    if (!isWritable(field)) continue;

    properties[fieldName] = fieldToJsonSchema(field);
    if (field.required && field.default === undefined) {
      required.push(fieldName);
    }
  }

  const schema = { type: "object", title: `Create${capitalize(model.name)}`, properties };
  if (required.length > 0) schema.required = required;
  return schema;
}

/**
 * The `update` DTO: every writable field except the primary key (a
 * primary key is never updated in place, auto-assigned or not - see
 * Repository#update(), which always identifies the row BY that key),
 * ALL optional - matching `prepareWrite()`'s partial-update semantics
 * (only fields explicitly provided are touched, nothing is required).
 *
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @returns {object} JSON Schema
 */
export function generateUpdateSchema(model) {
  const properties = {};
  for (const [fieldName, field] of Object.entries(model.fields)) {
    if (fieldName === model.primaryKey) continue;
    if (!isWritable(field)) continue;
    properties[fieldName] = fieldToJsonSchema(field);
  }
  return { type: "object", title: `Update${capitalize(model.name)}`, properties };
}

/**
 * The `read` DTO: every field with `expose !== false`, including the
 * primary key (present when read, even though absent - or, for a
 * non-auto key, required - from create/update).
 * A field that's genuinely required in the database is also required
 * here - a successfully-read row always has a value for it.
 *
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @returns {object} JSON Schema
 */
export function generateReadSchema(model) {
  const properties = {};
  const required = [];

  for (const [fieldName, field] of Object.entries(model.fields)) {
    if (!isExposed(field)) continue;
    properties[fieldName] = fieldToJsonSchema(field);
    if (field.required) required.push(fieldName);
  }
  // Computed fields are part of what a read returns, but can never be written,
  // so they appear here and (deliberately) in neither create nor update.
  for (const [fieldName, field] of Object.entries(model.computed ?? {})) {
    if (!isExposed(field)) continue;
    properties[fieldName] = { ...fieldToJsonSchema(field), readOnly: true };
  }

  const schema = { type: "object", title: `Read${capitalize(model.name)}`, properties };
  if (required.length > 0) schema.required = required;
  return schema;
}

/**
 * All three DTO schemas for one model at once.
 *
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @returns {{ create: object, update: object, read: object }}
 */
export function generateDTOSchemas(model) {
  return {
    create: generateCreateSchema(model),
    update: generateUpdateSchema(model),
    read: generateReadSchema(model),
  };
}

/**
 * Generates DTO schemas for every model in a registry.
 *
 * @param {import('../models/registry.js').ModelRegistry} modelRegistry
 * @returns {Record<string, { create: object, update: object, read: object }>}
 */
export function generateDTOSchemasForRegistry(modelRegistry) {
  modelRegistry.assertResolved();
  const result = {};
  for (const modelName of modelRegistry.listModels()) {
    result[modelName] = generateDTOSchemas(modelRegistry.getModel(modelName));
  }
  return result;
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
