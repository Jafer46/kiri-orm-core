/**
 * Normalizes `orderBy` into `[{ field, direction }]`, validating field names.
 *
 * Accepted forms (all interchangeable):
 *   "title"                          ascending
 *   "-title"                         descending (leading minus)
 *   ["title", "-createdAt"]          several keys, in priority order
 *   [["title", "desc"]]              [field, direction] pairs
 *   { field: "title", direction: "desc" }   (also inside an array)
 *
 * Only stored fields can be ordered by - computed fields have no column.
 *
 * @param {object} model
 * @param {unknown} orderBy
 * @returns {Array<{ field: string, direction: "asc"|"desc" }>}
 */
export declare function normalizeOrderBy(model: object, orderBy: unknown): Array<{
    field: string;
    direction: "asc" | "desc";
}>;
/**
 * The shape half of normalizeOrderBy(): turns every accepted spelling of `orderBy`
 * (`"-views"`, `["title", "desc"]`, `["a", "-b"]`, `{ field, direction }`, a list of
 * those) into `[{ field, direction }]`, rejecting a malformed entry, a bad direction or a
 * repeated field via `fail(message)`. It does NOT check that a field exists - the caller
 * knows what can be sorted (an ordinary query: model fields; an aggregate: group keys and
 * aggregate aliases).
 *
 * @param {unknown} orderBy
 * @param {(message: string) => never} fail
 * @returns {Array<{ field: string, direction: "asc"|"desc" }>}
 */
export declare function parseOrderBy(orderBy: unknown, fail: (message: string) => never): Array<{
    field: string;
    direction: "asc" | "desc";
}>;
/**
 * Validates `limit` / `offset`: non-negative integers when given.
 */
export declare function validatePaging(model: any, { limit, offset }: {
    limit: any;
    offset: any;
}): void;
/**
 * Applies ordering and paging to a Knex query builder.
 *
 * Pages are only stable if the order is total, so whenever the caller
 * orders or skips rows, the primary key is appended as a final
 * tie-breaker (unless it is already in the list). A bare `limit` with no
 * `orderBy` and no `offset` stays exactly as it always was: unordered.
 *
 * @returns {import('knex').Knex.QueryBuilder}
 */
export declare function applyOrderAndPaging(query: any, model: any, { orderBy, limit, offset }: {
    limit: any;
    offset: any;
    orderBy: any;
}): import('knex').Knex.QueryBuilder;
