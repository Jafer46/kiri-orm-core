export type ReportField = {
    kind: "key";
    from: string;
    bucket?: string;
} | {
    kind: "aggregate";
    agg: string;
    of: string | null;
} | {
    kind: "computed";
    compute: Function;
    depends: string[];
};
export type ReportDescriptor = {
    name: string;
    from: string;
    where: unknown;
    orderBy: unknown;
    fields: Readonly<Record<string, ReportField>>;
};
/**
 * @param {string} name
 * @param {object} definition
 * @returns {Readonly<ReportDescriptor>}
 * @throws {ReportDefinitionError}
 */
export declare function defineReport(name: string, definition: object): Readonly<ReportDescriptor>;
/**
 * The options aggregate() needs to run a report's fields: keys become `groupBy` entries named after
 * the report field, aggregates become `aggregates`.
 * @param {ReportDescriptor} descriptor
 * @returns {{ groupBy: object[], aggregates: Record<string, unknown> }}
 */
export declare function toAggregateOptions(descriptor: ReportDescriptor): {
    groupBy: object[];
    aggregates: Record<string, unknown>;
};
