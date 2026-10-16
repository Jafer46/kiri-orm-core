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
export declare function generateCreateSchema(model: import('../models/define-model.js').ModelDescriptor): object;
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
export declare function generateUpdateSchema(model: import('../models/define-model.js').ModelDescriptor): object;
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
export declare function generateReadSchema(model: import('../models/define-model.js').ModelDescriptor): object;
/**
 * All three DTO schemas for one model at once.
 *
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @returns {{ create: object, update: object, read: object }}
 */
export declare function generateDTOSchemas(model: import('../models/define-model.js').ModelDescriptor): {
    create: object;
    update: object;
    read: object;
};
/**
 * Generates DTO schemas for every model in a registry.
 *
 * @param {import('../models/registry.js').ModelRegistry} modelRegistry
 * @returns {Record<string, { create: object, update: object, read: object }>}
 */
export declare function generateDTOSchemasForRegistry(modelRegistry: import('../models/registry.js').ModelRegistry): Record<string, {
    create: object;
    update: object;
    read: object;
}>;
