/**
 * The name of a model's primary-key FIELD, or null if it has none.
 *
 * A model built by defineModel() carries `primaryKey` explicitly. The
 * fallback (a field literally named `id`) only serves descriptors that
 * predate declared primary keys, e.g. ones a test builds by hand.
 *
 * @param {{ primaryKey?: string|null, fields: Record<string, unknown> }} model
 * @returns {string|null}
 */
export declare function primaryKeyOf(model: {
    primaryKey?: string | null;
    fields: Record<string, unknown>;
}): string | null;
/** The primary key's column name, or null. */
export declare function primaryKeyColumnOf(model: any): any;
/**
 * Like primaryKeyOf(), but throws `ErrorClass` when the model has no
 * primary key. `needing` finishes the sentence "... needs a primary key".
 *
 * @param {object} model
 * @param {string} needing - what needs it, for the message
 * @param {new (message: string) => Error} ErrorClass
 * @returns {string}
 */
export declare function requirePrimaryKey(model: object, needing: string, ErrorClass?: new (message: string) => Error): string;
/**
 * Decides which field is the primary key while a model is being defined.
 *
 * Precedence: the model's `primaryKey` option, else the one field marked
 * `primaryKey: true`, else a field named `id`, else none.
 *
 * @param {string} modelName
 * @param {Record<string, object>} storedFields - the model's stored (non-computed) fields, raw
 * @param {unknown} declared - the model-level `primaryKey` option
 * @param {new (message: string) => Error} ErrorClass
 * @returns {string|null}
 */
export declare function resolvePrimaryKey(modelName: string, storedFields: Record<string, object>, declared: unknown, ErrorClass: new (message: string) => Error): string | null;
