/**
 * A floating-point number. Options:
 *   - min {number}
 *   - max {number}
 */
export declare const floatType: {
    name: string;
    validateOptions(field: any): string[];
    validate(field: any, value: any): string[];
    cast(field: any, value: any): number;
};
