import { describe, it, expect } from "vitest";
import { eachIsolatedDialect } from "../helpers/isolated-dialects.js";
import { captureQueries } from "../helpers/sql-capture.js";
import { makeApi, insertRows, SURFACES } from "../helpers/select-fixture.js";
import { ValidationError } from "../../src/crud/errors.js";

const selects = (queries) => queries.filter(({ sql }) => /^\s*select/i.test(sql));
const MATRIX = eachIsolatedDialect().flatMap((dialect) =>
  SURFACES.map((surface) => ({ name: `${dialect.name} / ${surface}`, surface, run: dialect.run }))
);

/**
 * Seven posts. Views have ties on purpose, so a page boundary can fall between rows that sort equal:
 *   id     1   2   3   4   5   6  7
 *   views 10  10  20  20  30   5  5     (odd ids published, even ids draft)
 */
async function seedPosts(db) {
  await insertRows(db, "author", [{ id: 1, firstName: "Ada", lastName: "Lovelace" }]);
  const views = [10, 10, 20, 20, 30, 5, 5];
  // Inserted in reverse id order, so rows that tie on a sort value only come out in id order if the query says so.
  await insertRows(db, "post", views.map((v, i) => ({ id: i + 1, authorId: 1, title: `P${i + 1}`, views: v, status: (i + 1) % 2 ? "published" : "draft" })).reverse());
}

describe.each(MATRIX)("paginate - $name", ({ surface, run }) => {
  const setup = (fn) =>
    run(async (db) => {
      const api = await makeApi(surface, db);
      await seedPosts(db);
      const post = api.handle("post");
      const ids = (page) => page.items.map((p) => p.id);
      return fn({ api, db, post, ids });
    });

  it("returns a page and everything a pager needs", () =>
    setup(async ({ post, ids }) => {
      const first = await post.paginate({}, { perPage: 3 });
      expect(ids(first)).toEqual([1, 2, 3]);
      expect(first).toMatchObject({ page: 1, perPage: 3, total: 7, pageCount: 3, hasNext: true, hasPrevious: false });

      const second = await post.paginate({}, { page: 2, perPage: 3 });
      expect([ids(second), second.hasNext, second.hasPrevious]).toEqual([[4, 5, 6], true, true]);

      const last = await post.paginate({}, { page: 3, perPage: 3 });
      expect([ids(last), last.hasNext, last.hasPrevious]).toEqual([[7], false, true]);
    }));

  it("defaults to page 1 and 20 per page", () =>
    setup(async ({ post, ids }) => {
      const result = await post.paginate();
      expect(result).toMatchObject({ page: 1, perPage: 20, total: 7, pageCount: 1, hasNext: false });
      expect(ids(result)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    }));

  it("a page past the end is empty, not an error, with the real total", () =>
    setup(async ({ post }) => {
      const result = await post.paginate({}, { page: 9, perPage: 3 });
      expect(result).toMatchObject({ items: [], page: 9, total: 7, pageCount: 3, hasNext: false, hasPrevious: true });
    }));

  it("no matches: total 0, no pages", () =>
    setup(async ({ post }) => {
      expect(await post.paginate({ status: "nope" })).toEqual({ items: [], page: 1, perPage: 20, total: 0, pageCount: 0, hasNext: false, hasPrevious: false });
    }));

  it("pages through ties without losing or repeating a row (the primary key is the tiebreaker)", () =>
    setup(async ({ post, ids }) => {
      // views: 5->30, 3,4->20, 1,2->10, 6,7->5. The page size splits the tied groups.
      const pages = [];
      for (const page of [1, 2, 3]) pages.push(ids(await post.paginate({}, { page, perPage: 3, orderBy: "-views" })));
      expect(pages).toEqual([[5, 3, 4], [1, 2, 6], [7]]);
      expect(pages.flat().sort()).toEqual([1, 2, 3, 4, 5, 6, 7]); // each exactly once

      const small = [];
      for (const page of [1, 2, 3, 4]) small.push(...ids(await post.paginate({}, { page, perPage: 2, orderBy: "views" })));
      expect(small).toEqual([6, 7, 1, 2, 3, 4, 5]);
    }));

  it("filters, with plain objects and domain arrays", () =>
    setup(async ({ post, ids }) => {
      const published = await post.paginate({ status: "published" }, { perPage: 3 });
      expect([ids(published), published.total, published.pageCount]).toEqual([[1, 3, 5], 4, 2]);
      const next = await post.paginate({ status: "published" }, { page: 2, perPage: 3 });
      expect(ids(next)).toEqual([7]);

      const busy = await post.paginate([["views", ">", 5]], { perPage: 2, orderBy: "-views" });
      expect([ids(busy), busy.total]).toEqual([[5, 3], 5]);
    }));

  it("takes select and with like find() does", () =>
    setup(async ({ post }) => {
      const result = await post.paginate({}, { perPage: 2, select: ["title"], with: { author: { select: ["firstName"] } } });
      expect(result.items.map((p) => [p.title, p.author.firstName])).toEqual([["P1", "Ada"], ["P2", "Ada"]]);
      expect(Object.keys(result.items[0]).sort()).toEqual(["author", "id", "title"].filter((k) => k !== "id" || surface !== "repository"));
    }));

  it("total: false skips the count and finds hasNext by looking one row ahead", () =>
    setup(async ({ post, ids, db }) => {
      const { queries, result } = await captureQueries(db, () => post.paginate({}, { perPage: 3, total: false }));
      expect(selects(queries)).toHaveLength(1);
      expect(result).toMatchObject({ total: null, pageCount: null, hasNext: true, hasPrevious: false });
      expect(ids(result)).toEqual([1, 2, 3]); // the extra look-ahead row isn't returned

      const last = await post.paginate({}, { page: 3, perPage: 3, total: false });
      expect([ids(last), last.hasNext, last.hasPrevious]).toEqual([[7], false, true]);
      expect((await post.paginate({}, { page: 5, perPage: 3, total: false })).items).toEqual([]);
    }));

  it("costs two statements (count + page), one when there is nothing to fetch", () =>
    setup(async ({ post, db }) => {
      const statements = async (filter, options) => selects((await captureQueries(db, () => post.paginate(filter, options))).queries).length;
      expect(await statements({}, { perPage: 3 })).toBe(2);
      expect(await statements({}, { page: 9, perPage: 3 })).toBe(1); // past the end: only the count
      expect(await statements({ status: "nope" }, {})).toBe(1);
    }));

  it("rejects bad paging before any SQL", () =>
    setup(async ({ post, db }) => {
      const { queries } = await captureQueries(db, async () => {
        const reject = async (options, option, pattern) => {
          const error = await post.paginate({}, options).catch((e) => e);
          expect(error, JSON.stringify(options)).toBeInstanceOf(ValidationError);
          expect(error.fieldErrors[option][0]).toMatch(pattern);
        };
        await reject({ page: 0 }, "page", /whole number from 1/);
        await reject({ page: -2 }, "page", /whole number from 1/);
        await reject({ page: 1.5 }, "page", /whole number from 1/);
        await reject({ page: "2" }, "page", /whole number from 1/);
        await reject({ perPage: 0 }, "perPage", /at least 1/);
        await reject({ perPage: 2.5 }, "perPage", /at least 1/);
        await reject({ limit: 5 }, "limit", /can't be combined with paginate\(\)/);
        await reject({ offset: 5 }, "offset", /use `page` and `perPage`/);
      });
      expect(queries).toHaveLength(0);
    }));

  it("on the tracked APIs the items are entities you can change and save", () =>
    setup(async ({ post, db }) => {
      const { items } = await post.paginate({}, { perPage: 2 });
      if (surface === "repository") {
        expect(items[0].save).toBeUndefined(); // plain records
        return;
      }
      items[0].title = "renamed";
      await items[0].save();
      expect((await db("post").where({ id: 1 }).first()).title).toBe("renamed");
    }));
});

describe.each(eachIsolatedDialect())("paginate inside a transaction - $name", ({ run }) => {
  it("Repository and global take { trx }, and count and page come from the same transaction", () =>
    run(async (db) => {
      for (const surface of ["repository", "global"]) {
        const api = await makeApi(surface, db);
        await seedPosts(db);
        const post = api.handle("post");
        const error = await db
          .transaction(async (trx) => {
            await insertRows(trx, "post", [{ id: 50, authorId: 1, title: "inside", views: 1, status: "draft" }]);
            const page = await post.paginate({}, { page: 3, perPage: 3, trx });
            throw Object.assign(new Error("rollback"), { page });
          })
          .catch((e) => e);
        expect(error.page.total).toBe(8);
        expect(error.page.items.map((p) => p.id)).toEqual([7, 50]);
        await db("post").del();
        await db("author").del();
      }
    }));
});
