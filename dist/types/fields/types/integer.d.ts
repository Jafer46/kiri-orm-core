/**
 * A whole number. Options:
 *   - min {number}
 *   - max {number}
 */
export declare const integerType: {
    name: string;
    validateOptions(field: any): string[];
    validate(field: any, value: any): string[];
    cast(field: any, value: any): number;
};
