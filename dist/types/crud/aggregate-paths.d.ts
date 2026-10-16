export type ToOneHop = {
    name: string;
    relation: object;
    from: object;
    to: object;
    parentField: string;
    targetField: string;
};
export type ToManyPath = {
    name: string;
    relation: object;
    kind: string;
    from: object;
    to: object;
    localField: string;
    childField?: string;
    through?: string;
    pivotKey?: string;
    pivotOther?: string;
    relatedKey?: string;
    insideHops: ToOneHop[];
};
export type ResolvedPath = {
    hops: ToOneHop[];
    many: ToManyPath | null;
    model: object;
    field: string | null;
    def: object | null;
};
/**
 * Resolves a dotted path such as `customer.company.country` or `items.product.price`, starting
 * at an aggregate's base model, into the pieces the SQL builder needs.
 *
 * The one distinction that matters is whether a relation can multiply rows:
 *
 * - **to-one** (`belongsTo` onto the related model's primary key): each row has at most one
 *   match, so a plain LEFT JOIN leaves the row count alone. These can be grouped by and
 *   aggregated freely, to any depth.
 * - **to-many** (`hasMany`, `hasOne`, `belongsToMany`): joining would repeat the row once per
 *   match, and `sum(order.total)` over that join counts every order once per item. These are
 *   aggregated in their own subquery, one row per parent, and joined on the parent's key (see
 *   aggregate.js). They can be aggregated but never grouped by - grouping by a to-many field
 *   isn't "one group per parent", it's a different grain.
 *
 * `hasOne` is treated as to-many on purpose: nothing stops a database holding two rows for one
 * parent, and a join would then silently double-count. (The eager loader quietly takes the first.)
 *
 * Supported shape: any number of to-one hops, OR one to-many relation first (followed by any to-one
 * hops inside it): `customer.company.country`, `items.amount`, `items.product.price`. A to-many
 * after a to-one hop (`customer.orders.total`) isn't supported yet, nor are two to-many relations.
 *
 * @typedef {{ name: string, relation: object, from: object, to: object, parentField: string, targetField: string }} ToOneHop
 * @typedef {{ name: string, relation: object, kind: string, from: object, to: object, localField: string,
 *   childField?: string, through?: string, pivotKey?: string, pivotOther?: string, relatedKey?: string,
 *   insideHops: ToOneHop[] }} ToManyPath
 * @typedef {{ hops: ToOneHop[], many: ToManyPath|null, model: object, field: string|null, def: object|null }} ResolvedPath
 */
/**
 * @param {object} model - the base model
 * @param {import('../models/registry.js').ModelRegistry|undefined} modelRegistry
 * @param {string} path
 * @param {object} options
 * @param {(message: string) => never} options.fail
 * @param {string} options.context - e.g. `groupBy "customer.country"`, prefixed to every message
 * @param {boolean} [options.allowMany] - a to-many relation may appear (aggregates yes, group keys no)
 * @param {boolean} [options.allowRelationEnd] - the path may end at a relation (only `count` does)
 * @returns {ResolvedPath}
 */
export declare function resolvePath(model: object, modelRegistry: import('../models/registry.js').ModelRegistry | undefined, path: string, { fail, context, allowMany, allowRelationEnd }: {
    fail: (message: string) => never;
    context: string;
    allowMany?: boolean;
    allowRelationEnd?: boolean;
}): ResolvedPath;
