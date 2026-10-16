import { describe, it, expect } from "vitest";
import { eachIsolatedDialect } from "../helpers/isolated-dialects.js";
import { captureQueries } from "../helpers/sql-capture.js";
import { makeApi, insertRows, seedConstrained, SURFACES } from "../helpers/select-fixture.js";
import { RelationError } from "../../src/relations/errors.js";

const selects = (queries) => queries.filter(({ sql }) => /^\s*select/i.test(sql));
const MATRIX = eachIsolatedDialect().flatMap((dialect) =>
  SURFACES.map((surface) => ({ name: `${dialect.name} / ${surface}`, surface, run: dialect.run }))
);

/** Data: see seedConstrained() - three posts (Ada, Alan, Ada), six comments on the first two, three tags. */
describe.each(MATRIX)("loadMany / load - $name", ({ surface, run }) => {
  const setup = (fn) =>
    run(async (db) => {
      const api = await makeApi(surface, db);
      await seedConstrained(db);
      const post = api.handle("post");
      const fresh = () => api.find("post", {}, { orderBy: "id" }); // posts without anything loaded
      return fn({ api, db, post, fresh });
    });

  it("loads a relation onto records you already hold, in one statement, in place", () =>
    setup(async ({ post, fresh, db }) => {
      const posts = await fresh();
      const { queries, result } = await captureQueries(db, () => post.loadMany(posts, "author"));
      expect(selects(queries)).toHaveLength(1);
      expect(result).toBe(posts); // the same array, changed in place
      expect(posts.map((p) => p.author.firstName)).toEqual(["Ada", "Alan", "Ada"]);
      expect(posts[0].author).toBe(posts[2].author); // one author row, one object
    }));

  it("takes the constraints of a `with` entry as options", () =>
    setup(async ({ post, fresh }) => {
      const posts = await fresh();
      await post.loadMany(posts, "comments", { orderBy: "-likes", limit: 2, select: ["body"] });
      expect(posts.map((p) => p.comments.map((c) => c.body))).toEqual([["c3", "c1"], ["c6", "c5"], []]);
      expect(Object.keys(posts[0].comments[0])).toEqual(["body"]);

      await post.loadMany(posts, "author", { select: ["firstName"], where: { firstName: "Ada" } });
      expect(posts.map((p) => p.author?.firstName ?? null)).toEqual(["Ada", null, "Ada"]);
    }));

  it("accepts a whole `with` value: several relations at once, in any shape", () =>
    setup(async ({ post, fresh, db }) => {
      const posts = await fresh();
      const { queries } = await captureQueries(db, () => post.loadMany(posts, ["author", { tags: { select: ["name"] }, comments: { limit: 1 } }]));
      expect(selects(queries)).toHaveLength(1 + 2 + 1); // author; tags (pivot + tags); comments
      expect(posts.map((p) => [p.author.firstName, p.tags.length, p.comments.length])).toEqual([["Ada", 3, 1], ["Alan", 2, 1], ["Ada", 0, 0]]);

      const again = await fresh();
      await post.loadMany(again, { author: true, comments: { orderBy: "-likes", limit: 1 } });
      expect(again.map((p) => p.comments.map((c) => c.body))).toEqual([["c3"], ["c6"], []]);
    }));

  it("is one statement however many records: 3 or 63", () =>
    run(async (db) => {
      const api = await makeApi(surface, db);
      await seedConstrained(db);
      const post = api.handle("post");
      const count = async () => {
        const posts = await api.find("post", {}, {});
        return { posts: posts.length, statements: selects((await captureQueries(db, () => post.loadMany(posts, "comments", { orderBy: "-likes", limit: 2 }))).queries).length };
      };
      const small = await count();
      await insertRows(db, "post", Array.from({ length: 60 }, (_, i) => ({ id: 100 + i, authorId: 1, title: `P${i}` })));
      const large = await count();
      expect([small.posts, large.posts]).toEqual([3, 63]);
      expect([small.statements, large.statements]).toEqual([1, 1]);
    }));

  it("load() on a loop is N statements - which is what loadMany() replaces", () =>
    setup(async ({ post, fresh, db }) => {
      const looped = await fresh();
      const loop = await captureQueries(db, async () => {
        for (const p of looped) await post.load(p, "author");
      });
      const batched = await fresh();
      const once = await captureQueries(db, () => post.loadMany(batched, "author"));
      expect(selects(loop.queries)).toHaveLength(3);
      expect(selects(once.queries)).toHaveLength(1);
      expect(looped.map((p) => p.author.firstName)).toEqual(batched.map((p) => p.author.firstName));
    }));

  it("load() returns the value and attaches it", () =>
    setup(async ({ post, fresh }) => {
      const [first] = await fresh();
      const comments = await post.load(first, "comments", { orderBy: "-likes", limit: 2 });
      expect(comments.map((c) => c.body)).toEqual(["c3", "c1"]);
      expect(first.comments).toBe(comments);
    }));

  it("an empty array sends nothing, but the spec is still checked", () =>
    setup(async ({ post, db }) => {
      const { queries } = await captureQueries(db, async () => {
        expect(await post.loadMany([], "author")).toEqual([]);
        await expect(post.loadMany([], "nope")).rejects.toBeInstanceOf(RelationError);
        await expect(post.loadMany([], "comments", { limit: -1 })).rejects.toThrow();
      });
      expect(queries).toHaveLength(0);
    }));

  it("a record read without the join key gets an error naming it", () =>
    setup(async ({ api, post }) => {
      const slim = await api.find("post", {}, { select: ["title"] });
      await expect(post.loadMany(slim, "author")).rejects.toThrow(/"authorId" was not loaded on the record.*Add "authorId" to the select/);
    }));

  it("loads nested relations under the loaded rows", () =>
    setup(async ({ post, fresh, db }) => {
      const posts = await fresh();
      const { queries } = await captureQueries(db, () => post.loadMany(posts, "comments", { limit: 1, with: { user: { select: ["firstName"] } } }));
      expect(selects(queries)).toHaveLength(2);
      expect(posts[0].comments[0].user.firstName).toBe("Ada");
    }));
});

describe.each(eachIsolatedDialect())("loadMany inside a transaction - $name", ({ run }) => {
  it("sees the transaction's uncommitted writes (Repository and global take { trx })", () =>
    run(async (db) => {
      for (const surface of ["repository", "global"]) {
        const api = await makeApi(surface, db);
        await seedConstrained(db);
        const post = api.handle("post");
        const posts = await api.find("post", {}, { orderBy: "id" });
        const error = await db
          .transaction(async (trx) => {
            await insertRows(trx, "comment", [{ id: 99, postId: 3, userId: 1, body: "new", likes: 1 }]);
            await post.loadMany(posts, "comments", { trx });
            throw Object.assign(new Error("rollback"), { bodies: posts[2].comments.map((c) => c.body) });
          })
          .catch((e) => e);
        expect(error.bodies).toEqual(["new"]);
        await db("comment").del();
        await db("post_tag").del();
        await db("post").del();
        await db("tag").del();
        await db("author").del();
      }
    }));
});
