import { ValidationError } from "./errors.js";

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

export const DEFAULT_PER_PAGE = 20;

/**
 * @param {{ modelName: string, count: (filter: unknown, options: object) => Promise<number>,
 *   find: (filter: unknown, options: object) => Promise<unknown[]> }} source - how to count and to fetch
 * @param {Record<string, unknown>|unknown[]} filter
 * @param {{ page?: number, perPage?: number, total?: boolean }} [options] - the rest goes to find()
 * @returns {Promise<Page>}
 */
export async function paginateWith({ modelName, count, find }, filter = {}, options = {}) {
  const { page = 1, perPage = DEFAULT_PER_PAGE, total: wantTotal = true, ...findOptions } = options;
  const fail = (option, message) => {
    throw new ValidationError(modelName, { [option]: [message] });
  };
  if (!Number.isInteger(page) || page < 1) fail("page", `\`page\` must be a whole number from 1 (got ${JSON.stringify(page)})`);
  if (!Number.isInteger(perPage) || perPage < 1) fail("perPage", `\`perPage\` must be a whole number of at least 1 (got ${JSON.stringify(perPage)})`);
  for (const key of ["limit", "offset"]) {
    if (key in findOptions) fail(key, `\`${key}\` can't be combined with paginate() - use \`page\` and \`perPage\``);
  }

  const offset = (page - 1) * perPage; // always passed, even 0: that is what makes find() add the primary-key tiebreaker

  if (!wantTotal) {
    const rows = await find(filter, { ...findOptions, limit: perPage + 1, offset });
    return { items: rows.slice(0, perPage), page, perPage, total: null, pageCount: null, hasNext: rows.length > perPage, hasPrevious: page > 1 };
  }

  const total = await count(filter, { trx: findOptions.trx });
  const items = total === 0 || offset >= total ? [] : await find(filter, { ...findOptions, limit: perPage, offset });
  const pageCount = Math.ceil(total / perPage);
  return { items, page, perPage, total, pageCount, hasNext: page < pageCount, hasPrevious: page > 1 };
}
