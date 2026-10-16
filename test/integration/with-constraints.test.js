import { describe, it, expect } from "vitest";
import { eachIsolatedDialect } from "../helpers/isolated-dialects.js";
import { captureQueries } from "../helpers/sql-capture.js";
import { makeApi, insertRows, seedConstrained, SURFACES } from "../helpers/select-fixture.js";
import { RelationError } from "../../src/relations/errors.js";
import { ValidationError } from "../../src/crud/errors.js";

const selects = (queries) => queries.filter(({ sql }) => /^\s*select/i.test(sql));
const keys = (obj) => Object.keys(obj).sort();
const MATRIX = eachIsolatedDialect().flatMap((dialect) =>
  SURFACES.map((surface) => ({ name: `${dialect.name} / ${surface}`, surface, run: dialect.run }))
);

describe.each(MATRIX)("constrained with - $name", ({ surface, run }) => {
  const setup = (fn) =>
    run(async (db) => {
      const api = await makeApi(surface, db);
      await seedConstrained(db);
      const posts = (withSpec) => api.find("post", {}, { orderBy: "id", with: withSpec });
      const per = async (withSpec, relation, pick) => (await posts(withSpec)).map((p) => (p[relation] ?? []).map(pick));
      return fn({ api, db, posts, per });
    });
  const body = (r) => r.body;
  const name = (r) => r.name;
  // Without an orderBy, rows come back in the database's own order (insertion order on Postgres), so these
  // cases compare each parent's rows as a set. A `limit` or `offset` is different: it adds the primary key as
  // a tiebreaker, because WHICH rows are picked must not depend on the database's whim.
  const unordered = (groups) => groups.map((g) => [...g].sort());

  describe("limit, offset and orderBy are applied PER PARENT", () => {
    it("the top N of each post, not N overall", () =>
      setup(async ({ per }) => {
        expect(await per({ comments: { orderBy: "-likes", limit: 2 } }, "comments", body)).toEqual([["c3", "c1"], ["c6", "c5"], []]);
      }));

    it("offset skips within each parent", () =>
      setup(async ({ per }) => {
        expect(await per({ comments: { orderBy: "-likes", limit: 2, offset: 1 } }, "comments", body)).toEqual([["c1", "c2"], ["c5"], []]);
        expect(await per({ comments: { offset: 3 } }, "comments", body)).toEqual([["c4"], [], []]); // offset with no limit
      }));

    it("without orderBy the primary key decides, so a limit is deterministic", () =>
      setup(async ({ per }) => {
        expect(await per({ comments: { limit: 2 } }, "comments", body)).toEqual([["c1", "c2"], ["c5", "c6"], []]);
      }));

    it("orderBy alone orders each parent's rows, ascending or descending", () =>
      setup(async ({ per }) => {
        expect(await per({ comments: { orderBy: "likes" } }, "comments", body)).toEqual([["c4", "c2", "c1", "c3"], ["c5", "c6"], []]);
        expect(await per({ comments: { orderBy: ["-likes"] } }, "comments", body)).toEqual([["c3", "c1", "c2", "c4"], ["c6", "c5"], []]);
      }));

    it("a hasOne with orderBy picks which row counts as the one", () =>
      setup(async ({ posts }) => {
        const result = await posts({ pinned: { orderBy: "-likes" } });
        expect(result.map((p) => p.pinned?.body ?? null)).toEqual(["c3", "c6", null]);
      }));
  });

  describe("where constrains which related rows load", () => {
    it("a plain object or a domain array", () =>
      setup(async ({ per }) => {
        expect(unordered(await per({ comments: { where: [["likes", ">", 2]] } }, "comments", body))).toEqual([["c1", "c2", "c3"], ["c6"], []]);
        expect(unordered(await per({ comments: { where: { userId: 1 } } }, "comments", body))).toEqual([["c1", "c3"], ["c5"], []]);
      }));

    it("may cross relations of the related model", () =>
      setup(async ({ per }) => {
        expect(unordered(await per({ comments: { where: [["user.firstName", "=", "Ada"]] } }, "comments", body))).toEqual([["c1", "c3"], ["c5"], []]);
      }));

    it("combines with orderBy and limit", () =>
      setup(async ({ per }) => {
        expect(await per({ comments: { where: [["likes", ">", 1]], orderBy: "-likes", limit: 2 } }, "comments", body)).toEqual([["c3", "c1"], ["c6", "c5"], []]);
        expect(await per({ comments: { where: [["likes", ">", 4]], limit: 1 } }, "comments", body)).toEqual([["c1"], ["c6"], []]);
      }));

    it("on a belongsTo, a related row that doesn't match gives null", () =>
      setup(async ({ posts }) => {
        const result = await posts({ author: { where: { firstName: "Ada" } } });
        expect(result.map((p) => p.author?.firstName ?? null)).toEqual(["Ada", null, "Ada"]);
      }));
  });

  describe("belongsToMany", () => {
    it("orderBy + limit per parent (one statement for the pivot and the tags together)", () =>
      setup(async ({ per, posts, db }) => {
        expect(await per({ tags: { orderBy: "name", limit: 2 } }, "tags", name)).toEqual([["alpha", "beta"], ["beta", "gamma"], []]);
        expect(await per({ tags: { orderBy: "-name", limit: 1 } }, "tags", name)).toEqual([["gamma"], ["gamma"], []]);
        expect(await per({ tags: { orderBy: "name", limit: 1, offset: 1 } }, "tags", name)).toEqual([["beta"], ["gamma"], []]);
        const { queries } = await captureQueries(db, () => posts({ tags: { orderBy: "name", limit: 2 } }));
        expect(selects(queries)).toHaveLength(2); // posts + one joined statement (not posts + pivot + tags)
      }));

    it("orderBy alone orders by the related row, not the pivot", () =>
      setup(async ({ per }) => {
        expect(await per({ tags: { orderBy: "-name" } }, "tags", name)).toEqual([["gamma", "beta", "alpha"], ["gamma", "beta"], []]);
      }));

    it("where alone filters the related rows", () =>
      setup(async ({ per }) => {
        expect(await per({ tags: { where: { name: "beta" } } }, "tags", name)).toEqual([["beta"], ["beta"], []]);
        expect(await per({ tags: { where: [["name", "!=", "alpha"]], orderBy: "name", limit: 1 } }, "tags", name)).toEqual([["beta"], ["beta"], []]);
      }));

    it("a tag shared by two parents is one object, as without constraints", () =>
      setup(async ({ posts, api }) => {
        const [a, b] = await posts({ tags: { orderBy: "name", limit: 2 } });
        expect(a.tags[1].name).toBe("beta");
        expect(a.tags[1]).toBe(b.tags[0]);
        void api;
      }));
  });

  describe("combined with select and nested with", () => {
    it("select + window: the rank and the join keys don't leak into the result", () =>
      setup(async ({ posts }) => {
        const result = await posts({ comments: { select: ["body"], orderBy: "-likes", limit: 1 }, tags: { select: ["name"], orderBy: "name", limit: 1 } });
        expect(result[0].comments.map(keys)).toEqual([["body"]]);
        expect(result[0].tags.map(keys)).toEqual([["name"]]);
      }));

    it("nested relations load under the limited rows only", () =>
      setup(async ({ posts, db }) => {
        const { queries, result } = await captureQueries(db, () =>
          posts({ comments: { select: ["body"], orderBy: "-likes", limit: 1, with: { user: { select: ["firstName"] } } } })
        );
        expect(result[0].comments.map((c) => [c.body, c.user.firstName, keys(c)])).toEqual([["c3", "Ada", ["body", "user"]]]);
        expect(result[1].comments.map((c) => [c.body, c.user.firstName])).toEqual([["c6", "Alan"]]);
        expect(selects(queries)).toHaveLength(3); // posts, limited comments, their users
      }));

    it("the same relation named twice merges: wheres are ANDed, equal limits are fine", () =>
      setup(async ({ per }) => {
        expect(unordered(await per([{ comments: { where: [["likes", ">", 1]] } }, { comments: { where: [["likes", "<", 9]] } }], "comments", body))).toEqual([["c1", "c2"], ["c5", "c6"], []]);
        expect(await per([{ comments: { limit: 1 } }, "comments"], "comments", body)).toEqual([["c1"], ["c5"], []]);
        expect(await per([{ comments: { limit: 1 } }, { comments: { limit: 1 } }], "comments", body)).toEqual([["c1"], ["c5"], []]);
      }));
  });

  describe("one statement per relation, however many parents", () => {
    it("the number of statements doesn't grow with the number of posts", () =>
      run(async (db) => {
        const api = await makeApi(surface, db);
        const spec = {
          author: { where: { firstName: "Ada" } }, comments: { orderBy: "-likes", limit: 2 },
          pinned: { orderBy: "-likes" }, tags: { orderBy: "name", limit: 2 },
        };
        const count = async () => selects((await captureQueries(db, () => api.find("post", {}, { with: spec }))).queries).length;

        await seedConstrained(db);
        const small = await count();
        await insertRows(db, "post", Array.from({ length: 60 }, (_, i) => ({ id: 100 + i, authorId: 1 + (i % 2), title: `P${i}` })));
        await insertRows(db, "comment", Array.from({ length: 120 }, (_, i) => ({ id: 100 + i, postId: 100 + (i % 60), userId: 1, body: `x${i}`, likes: i })));
        const large = await count();

        expect(small).toBe(5); // posts, author, comments, pinned, tags (joined)
        expect(large).toBe(small);
      }));
  });

  describe("rejected before any SQL is sent", () => {
    it("options that don't fit the relation, bad fields, conflicting repeats", () =>
      setup(async ({ api, db }) => {
        const find = (withSpec) => api.find("post", {}, { with: withSpec });
        const { queries } = await captureQueries(db, async () => {
          await expect(find({ author: { limit: 1 } })).rejects.toThrow(/`limit` doesn't apply to relation "author" on model "post": a belongsTo has at most one/);
          await expect(find({ author: { offset: 1 } })).rejects.toThrow(RelationError);
          await expect(find({ author: { orderBy: "id" } })).rejects.toThrow(/`orderBy` doesn't apply to relation "author"/);
          await expect(find({ pinned: { limit: 1 } })).rejects.toThrow(/`limit` doesn't apply to relation "pinned".*hasOne/);
          await expect(find({ comments: { orderBy: "nope" } })).rejects.toBeInstanceOf(ValidationError);
          await expect(find({ comments: { limit: -1 } })).rejects.toBeInstanceOf(ValidationError);
          await expect(find({ comments: { limit: 1.5 } })).rejects.toBeInstanceOf(ValidationError);
          await expect(find({ comments: { where: [["nope", "=", 1]] } })).rejects.toThrow(/Invalid `where` for relation "comments" on model "post"/);
          await expect(find({ comments: { where: [["likes", "~~", 1]] } })).rejects.toThrow(RelationError);
          await expect(find([{ comments: { limit: 1 } }, { comments: { limit: 2 } }])).rejects.toThrow(/`limit` is given twice for relation "comments" with different values/);
          await expect(find([{ comments: { orderBy: "likes" } }, { comments: { orderBy: "-likes" } }])).rejects.toThrow(/`orderBy` is given twice/);
          await expect(find({ comments: { wher: [] } })).rejects.toThrow(/Unknown option "wher".*select, with, where, orderBy, limit, offset/);
        });
        expect(queries).toHaveLength(0);
      }));
  });
});
