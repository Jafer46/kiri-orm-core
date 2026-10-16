/**
 * Thrown by Repository#create()/#update() when field validation fails,
 * or when the caller references a field name that isn't on the model
 * (a filter key, a write key, etc.) - both are surfaced through the
 * same `fieldErrors` shape so a caller only needs to handle one error
 * type to report every kind of "your data/filter was wrong" problem.
 */
export declare class ValidationError extends Error {
    modelName: string;
    fieldErrors: Record<string, string[]>;
    /**
     * @param {string} modelName
     * @param {Record<string, string[]>} fieldErrors
     */
    constructor(modelName: string, fieldErrors: Record<string, string[]>);
}
