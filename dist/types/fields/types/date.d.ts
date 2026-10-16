/**
 * A calendar date (no time component, though the canonical runtime
 * representation is still a JS Date - the schema-sync layer in a later
 * phase is what maps this to a DATE vs DATETIME column per dialect).
 */
export declare const dateType: {
    name: string;
    validate(field: any, value: any): string[];
    cast(field: any, value: any): any;
};
