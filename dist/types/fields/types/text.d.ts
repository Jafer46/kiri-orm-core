/**
 * Long-form text (maps to TEXT in most dialects). Unlike `char`, there
 * is no default length cap - set `maxLength` explicitly if you want one.
 */
export declare const textType: {
    name: string;
    validateOptions(field: any): string[];
    validate(field: any, value: any): string[];
    cast(field: any, value: any): string;
};
