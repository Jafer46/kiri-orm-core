/**
 * DTO schemas (create/update/read) for one model registered via
 * `createModel()`, using the default registry - the Mongoose-style
 * API's equivalent of calling `generateDTOSchemas(model)` directly
 * with an explicit `ModelRegistry`.
 *
 * @param {string} modelName
 * @returns {{ create: object, update: object, read: object }}
 */
export declare function generateModelDTOs(modelName: string): {
    create: object;
    update: object;
    read: object;
};
/**
 * DTO schemas for every model registered via `createModel()`.
 *
 * @returns {Record<string, { create: object, update: object, read: object }>}
 */
export declare function generateAllModelDTOs(): Record<string, {
    create: object;
    update: object;
    read: object;
}>;
/**
 * JSDoc `@typedef` blocks for every model registered via
 * `createModel()`, concatenated into one file-ready string.
 *
 * @returns {string}
 */
export declare function generateModelJSDoc(): string;
