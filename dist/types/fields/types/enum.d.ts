/**
 * A value constrained to a fixed set of options. Requires a `values`
 * array on the field descriptor, e.g.:
 *   { type: "enum", values: ["draft", "sent", "paid"] }
 */
export declare const enumType: {
    name: string;
    validateOptions(field: any): string[];
    validate(field: any, value: any): string[];
    cast(field: any, value: any): string;
};
