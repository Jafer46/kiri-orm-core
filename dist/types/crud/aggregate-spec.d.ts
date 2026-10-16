export type GroupKey = {
    alias: string;
    kind: "field" | "bucket";
    field: string;
    fieldPath: string;
    bucket?: string;
    hops: object[];
    def: object;
};
export type AggregateColumn = {
    alias: string;
    fn: "count" | "countDistinct" | "sum" | "avg" | "min" | "max";
    field: string | null;
    fieldPath: string | null;
    hops: object[];
    many: object | null;
    def: object | null;
};
export type AggregatePlan = {
    keys: GroupKey[];
    aggregates: AggregateColumn[];
    order: Array<{
        entry: GroupKey | AggregateColumn;
        direction: "asc" | "desc";
    }>;
    limit?: number;
    offset?: number;
};
/**
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {object} options - the options object given to aggregate()
 * @param {import('../models/registry.js').ModelRegistry} [modelRegistry] - needed to follow relations
 * @returns {AggregatePlan}
 * @throws {ValidationError} keyed by the option at fault: `groupBy`, `aggregates` or `orderBy`
 */
export declare function planAggregate(model: import('../models/define-model.js').ModelDescriptor, options?: object, modelRegistry?: import('../models/registry.js').ModelRegistry): AggregatePlan;
