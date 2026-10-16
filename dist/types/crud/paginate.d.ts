export type Page = {
    items: unknown[];
    page: number;
    perPage: number;
    total: number | null;
    pageCount: number | null;
    hasNext: boolean;
    hasPrevious: boolean;
};
/**
 * Page-number pagination: `paginate(filter, { page, perPage, ...findOptions })` returns one page of
 * rows plus what a UI needs to draw the pager.
 *
 * ```js
 * const result = await Post.paginate({ status: "published" }, { page: 2, perPage: 20, orderBy: "-views", with: ["author"] });
 * // { items: [...], page: 2, perPage: 20, total: 137, pageCount: 7, hasNext: true, hasPrevious: true }
 * ```
 *
 * It is `count()` plus `find({ limit, offset })`, so it takes everything find() takes (`orderBy`,
 * `select`, `with`, `trx`, ...) and works the same on the plain Repository, `client.models.*` and
 * `createModel()` models - `items` are whatever that surface's find() returns (entities / documents on
 * the tracked ones).
 *
 * - **Stable pages.** find() adds the primary key as a final tiebreaker whenever an offset is used, so
 *   rows with equal sort values land on exactly one page. Without that, paging by `status` could show a
 *   row twice and skip another.
 * - **Two statements** (count, then the page); one if the page is past the end (nothing to fetch), or
 *   with `total: false`.
 * - **`total: false`** skips the count - which can be the expensive part on a big table - and finds
 *   `hasNext` by asking for one row more than the page. `total` and `pageCount` are then `null`.
 * - The two statements aren't one snapshot: rows added between them can make `total` a little off. Pass a
 *   transaction (`trx`) for a consistent read.
 *
 * Page numbers start at 1. A page past the last is not an error: it is empty, with the real `total`.
 *
 * @typedef {{ items: unknown[], page: number, perPage: number, total: number|null, pageCount: number|null,
 *   hasNext: boolean, hasPrevious: boolean }} Page
 */
export declare const DEFAULT_PER_PAGE = 20;
/**
 * @param {{ modelName: string, count: (filter: unknown, options: object) => Promise<number>,
 *   find: (filter: unknown, options: object) => Promise<unknown[]> }} source - how to count and to fetch
 * @param {Record<string, unknown>|unknown[]} filter
 * @param {{ page?: number, perPage?: number, total?: boolean }} [options] - the rest goes to find()
 * @returns {Promise<Page>}
 */
export declare function paginateWith({ modelName, count, find }: {
    modelName: string;
    count: (filter: unknown, options: object) => Promise<number>;
    find: (filter: unknown, options: object) => Promise<unknown[]>;
}, filter?: Record<string, unknown> | unknown[], options?: {
    page?: number;
    perPage?: number;
    total?: boolean;
}): Promise<Page>;
