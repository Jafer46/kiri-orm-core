/**
 * Any JSON-serializable value (object, array, or primitive). Maps to a
 * JSON/JSONB column depending on dialect in a later phase.
 */
export declare const jsonType: {
    name: string;
    validate(field: any, value: any): string[];
    cast(field: any, value: any): any;
};
