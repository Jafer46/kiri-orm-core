/**
 * A date + time value. Kept as a separate type from `date` (rather than
 * an option on it) so the future schema-sync layer can map them to
 * distinct column types (DATE vs TIMESTAMP) per dialect without
 * inspecting field options.
 */
export declare const datetimeType: {
    name: string;
    validate(field: any, value: any): string[];
    cast(field: any, value: any): any;
};
