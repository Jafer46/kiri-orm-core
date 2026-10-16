/**
 * A short, single-line string (maps to VARCHAR in most dialects).
 * Options:
 *   - maxLength {number} default 255
 *   - minLength {number} default 0
 */
export declare const charType: {
    name: string;
    validateOptions(field: any): string[];
    validate(field: any, value: any): string[];
    cast(field: any, value: any): string;
};
