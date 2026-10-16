import { describe, it, expect } from "vitest";
import { eachIsolatedDialect } from "../helpers/isolated-dialects.js";
import { captureQueries } from "../helpers/sql-capture.js";
import { makeApi, seed, seedMany, insertRows, SURFACES } from "../helpers/select-fixture.js";
import { ValidationError } from "../../src/crud/errors.js";
import { RelationError } from "../../src/relations/errors.js";
import { withIdentityMap } from "../../src/global/index.js";

const keys = (obj) => Object.keys(obj).sort();
// Matches a quoted column in the SQL of either dialect (SQLite quotes with backticks, Postgres with ").
const col = (...names) => new RegExp(names.map((n) => `["\`]${n}["\`]`).join("|"));
const selects = (queries) => queries.filter(({ sql }) => /^\s*select/i.test(sql));

/** Every case runs on both dialects x all three ways of reading. */
const MATRIX = eachIsolatedDialect().flatMap((dialect) =>
  SURFACES.map((surface) => ({ name: `${dialect.name} / ${surface}`, surface, run: dialect.run }))
);

describe.each(MATRIX)("select - $name", ({ surface, run }) => {
  const setup = (fn) => run(async (db) => { const api = await makeApi(surface, db); await seed(db); return fn(api, db); });
  // The tracked APIs add the primary key so a document can save itself; a plain Repository doesn't.
  const withId = (api, ...names) => (api.tracked ? ["id", ...names] : names).sort();

  describe("on the model itself", () => {
    it("reads only the selected columns, and the SQL says so", () =>
      setup(async (api, db) => {
        const { queries, result } = await captureQueries(db, () => api.find("post", { status: "published" }, { select: ["title", "views"], orderBy: "id" }));
        expect(result.map((r) => keys(r))).toEqual([withId(api, "title", "views"), withId(api, "title", "views")]);
        expect(result.map((r) => r.title)).toEqual(["P1", "P2"]);
        const sql = selects(queries)[0].sql;
        expect(sql).not.toMatch(/\*/);
        expect(sql).not.toMatch(col("body", "meta", "author_id"));
      }));

    it("without `select` it is still select * with every field (unchanged behaviour)", () =>
      setup(async (api, db) => {
        const { queries, result } = await captureQueries(db, () => api.findOne("post", { id: 1 }));
        expect(selects(queries)[0].sql).toMatch(/\*/);
        expect(keys(result)).toEqual(["authorId", "body", "id", "meta", "publishedAt", "status", "title", "views"]);
      }));

    it("filtering and ordering by a column that isn't selected works", () =>
      setup(async (api) => {
        const rows = await api.find("post", [["status", "=", "published"]], { select: ["title"], orderBy: "-views" });
        expect(rows.map((r) => r.title)).toEqual(["P2", "P1"]);
        expect(rows[0].views).toBeUndefined();
      }));

    it("still casts the selected values (json, datetime)", () =>
      setup(async (api) => {
        const post = await api.findOne("post", { id: 1 }, { select: ["meta", "publishedAt"] });
        expect(post.meta).toEqual({ a: 1 });
        expect(post.publishedAt).toBeInstanceOf(Date);
        expect(post.publishedAt.toISOString()).toBe("2024-01-02T03:04:05.000Z");
      }));

    it("a computed field brings the stored fields it depends on, and only those", () =>
      setup(async (api, db) => {
        const { queries, result } = await captureQueries(db, () => api.findOne("author", { id: 1 }, { select: ["fullName"] }));
        expect(keys(result)).toEqual(withId(api, "firstName", "fullName", "lastName"));
        expect(result.fullName).toBe("Ada Lovelace");
        expect(selects(queries)[0].sql).not.toMatch(col("email", "bio"));
      }));

    it("follows computed -> computed -> stored, and doesn't define computed fields nobody asked for", () =>
      setup(async (api) => {
        const author = await api.findOne("author", { id: 2 }, { select: ["badge"] });
        expect(keys(author)).toEqual(withId(api, "badge", "firstName", "fullName", "lastName"));
        expect(author.badge).toBe("[Alan Turing]");
        expect("initials" in author).toBe(false); // computable from what was loaded, but not requested
      }));

    it("a computed field that depends on nothing selects one column, hidden", () =>
      setup(async (api) => {
        const author = await api.findOne("author", { id: 1 }, { select: ["always"] });
        expect(author.always).toBe("const");
        expect(keys(author)).toEqual(withId(api, "always"));
      }));

    it("a selected record never computes from fields that weren't loaded", () =>
      setup(async (api) => {
        const author = await api.findOne("author", { id: 1 }, { select: ["email"] });
        expect(keys(author)).toEqual(withId(api, "email"));
        expect("fullName" in author).toBe(false);
      }));

    it("rejects bad selections before sending any SQL", () =>
      setup(async (api, db) => {
        const { queries } = await captureQueries(db, async () => {
          const reject = async (select, pattern) => {
            const error = await api.find("post", {}, { select }).catch((e) => e);
            expect(error).toBeInstanceOf(ValidationError);
            expect(error.fieldErrors.select[0]).toMatch(pattern);
          };
          await reject(["nope"], /unknown field "nope"\. Fields: id, authorId, title/);
          await reject(["author"], /"author" is a relation, not a field.*with/);
          await reject([], /at least one field/);
          await reject("title", /must be an array/);
          await reject([""], /non-empty strings/);
        });
        expect(queries).toHaveLength(0);
      }));

    it("duplicates in `select` are harmless", () =>
      setup(async (api) => {
        const post = await api.findOne("post", { id: 1 }, { select: ["title", "title", "id"] });
        expect(keys(post)).toEqual(["id", "title"]);
      }));
  });

  describe("with: object form", () => {
    it("belongsTo: narrows the related row and hides the join key it read to match", () =>
      setup(async (api, db) => {
        const { queries, result } = await captureQueries(db, () => api.find("post", {}, { orderBy: "id", with: { author: { select: ["email"] } } }));
        expect(selects(queries)).toHaveLength(2);
        expect(result.map((p) => p.author && keys(p.author))).toEqual([["email"], ["email"], ["email"], null]);
        expect(result.map((p) => p.author?.email)).toEqual(["ada@example.com", "ada@example.com", "alan@example.com", undefined]);
        expect(selects(queries)[1].sql).not.toMatch(col("bio", "first_name"));
        expect(keys(result[0])).toContain("body"); // the parent was not narrowed
      }));

    it("belongsTo: the parent's foreign key is read for matching but not returned when not selected", () =>
      setup(async (api) => {
        const posts = await api.find("post", {}, { orderBy: "id", select: ["title"], with: { author: { select: ["email"] } } });
        expect(posts.map((p) => keys(p))).toEqual(Array(4).fill(withId(api, "author", "title")));
        expect(posts.map((p) => p.author?.email ?? null)).toEqual(["ada@example.com", "ada@example.com", "alan@example.com", null]);
      }));

    it("...and is returned when it was selected", () =>
      setup(async (api) => {
        const [post] = await api.find("post", { id: 1 }, { select: ["title", "authorId"], with: { author: { select: ["email"] } } });
        expect(post.authorId).toBe(1);
        expect(keys(post.author)).toEqual(["email"]);
      }));

    it("hasMany: groups correctly, one query, join keys hidden, other columns not read", () =>
      setup(async (api, db) => {
        const { queries, result } = await captureQueries(db, () => api.find("post", [["id", "in", [1, 2, 3]]], { orderBy: "id", with: { comments: { select: ["body"] } } }));
        expect(selects(queries)).toHaveLength(2);
        expect(result.map((p) => p.comments.map((c) => c.body).sort())).toEqual([["c1", "c2"], ["c3"], []]);
        for (const post of result) for (const c of post.comments) expect(keys(c)).toEqual(["body"]);
        expect(selects(queries)[1].sql).not.toMatch(col("likes", "user_id"));
      }));

    it("hasOne", () =>
      setup(async (api) => {
        const [post] = await api.find("post", { id: 2 }, { with: { pinned: { select: ["body"] } } });
        expect(keys(post.pinned)).toEqual(["body"]);
        expect(post.pinned.body).toBe("c3");
      }));

    it("belongsToMany: three queries, the pivot only reads its two link columns", () =>
      setup(async (api, db) => {
        const { queries, result } = await captureQueries(db, () => api.find("post", [["id", "in", [1, 2, 3, 4]]], { orderBy: "id", with: { tags: { select: ["name"] } } }));
        const reads = selects(queries);
        expect(reads).toHaveLength(3);
        expect(reads[1].sql).toMatch(col("post_id", "tag_id"));
        expect(reads[1].sql).not.toMatch(/\*/);
        expect(result.map((p) => p.tags.map((t) => t.name).sort())).toEqual([["code", "math"], ["code"], ["ai"], []]);
        for (const post of result) for (const tag of post.tags) expect(keys(tag)).toEqual(["name"]);
      }));

    it("a relation's computed field pulls its own dependencies, hidden keys stay hidden", () =>
      setup(async (api) => {
        const [post] = await api.find("post", { id: 1 }, { with: { author: { select: ["fullName"] } } });
        expect(keys(post.author)).toEqual(["firstName", "fullName", "lastName"]);
        expect(post.author.fullName).toBe("Ada Lovelace");
      }));

    it("selecting the join key on the related side keeps it", () =>
      setup(async (api) => {
        const [post] = await api.find("post", { id: 1 }, { with: { comments: { select: ["postId", "body"] } } });
        for (const c of post.comments) expect(keys(c)).toEqual(["body", "postId"]);
      }));

    it("nested: select at every level, and the keys each level needs are hidden at the end", () =>
      setup(async (api, db) => {
        const { queries, result } = await captureQueries(db, () =>
          api.find("post", { id: 1 }, { with: { comments: { select: ["body"], with: { user: { select: ["firstName"] } } } } })
        );
        expect(selects(queries)).toHaveLength(3);
        const comments = result[0].comments.sort((a, b) => a.body.localeCompare(b.body));
        expect(comments.map((c) => keys(c))).toEqual([["body", "user"], ["body", "user"]]); // userId was read to match, then removed
        expect(comments.map((c) => c.user.firstName)).toEqual(["Alan", "Ada"]);
        expect(comments.map((c) => keys(c.user))).toEqual([["firstName"], ["firstName"]]);
      }));

    it("a dotted key narrows the last relation of the path", () =>
      setup(async (api) => {
        const [post] = await api.find("post", { id: 1 }, { with: { "comments.user": { select: ["email"] } } });
        expect(keys(post.comments[0])).toContain("body"); // `comments` is bare = every field
        expect(post.comments.map((c) => keys(c.user))).toEqual([["email"], ["email"]]);
      }));

    it("accepts the array shorthand, `true`, `false`, and strings mixed with objects", () =>
      setup(async (api, db) => {
        const { queries, result } = await captureQueries(db, () =>
          api.find("post", { id: 1 }, { with: ["tags", { author: ["email"], comments: true, pinned: false }] })
        );
        const [post] = result;
        expect(keys(post.author)).toEqual(["email"]);
        expect(post.comments).toHaveLength(2);
        expect(keys(post.comments[0])).toContain("likes");
        expect(post.tags).toHaveLength(2);
        expect("pinned" in post).toBe(false);
        expect(selects(queries)).toHaveLength(1 + 1 + 1 + 2); // post, author, comments, tags + pivot
      }));

    it("the same relation named twice loads once; an explicit select beats a bare name", () =>
      setup(async (api, db) => {
        const { queries, result } = await captureQueries(db, () =>
          api.find("post", { id: 1 }, { with: ["comments.user", { comments: { select: ["body"] } }] })
        );
        expect(selects(queries)).toHaveLength(3); // post, comments (once), users
        expect(result[0].comments.map((c) => keys(c))).toEqual([["body", "user"], ["body", "user"]]);
      }));

    it("selects of the same relation are unioned when merged", () =>
      setup(async (api) => {
        const [post] = await api.find("post", { id: 1 }, { with: [{ comments: ["body"] }, { comments: ["likes"] }] });
        expect(keys(post.comments[0])).toEqual(["body", "likes"]);
      }));

    it("the old forms are unchanged: names and dotted paths load full records", () =>
      setup(async (api) => {
        const [post] = await api.find("post", { id: 1 }, { with: ["author", "comments.user"] });
        // every stored field, plus the computed ones (enumerable by design, so a full record lists them)
        expect(keys(post.author)).toEqual(["always", "badge", "bio", "email", "firstName", "fullName", "id", "initials", "lastName"]);
        expect(post.author.fullName).toBe("Ada Lovelace");
        expect(post.comments[0].user.fullName).toMatch(/Ada|Alan/);
        expect(keys(post.comments[0])).toEqual(["body", "id", "likes", "postId", "user", "userId"]);
      }));

    it("validates the whole tree before any query: unknown relation, option, field, shape", () =>
      setup(async (api, db) => {
        const { queries } = await captureQueries(db, async () => {
          await expect(api.find("post", {}, { with: { nope: true } })).rejects.toThrow(RelationError);
          await expect(api.find("post", {}, { with: ["comments.nope"] })).rejects.toThrow(/Unknown relation "nope" on model "comment"/);
          await expect(api.find("post", {}, { with: { author: { select: ["nope"] } } })).rejects.toBeInstanceOf(ValidationError);
          await expect(api.find("post", {}, { with: { comments: { with: { user: { select: ["nope"] } } } } })).rejects.toBeInstanceOf(ValidationError);
          await expect(api.find("post", {}, { with: { author: { selct: ["name"] } } })).rejects.toThrow(/Unknown option "selct" for relation "author"/);
          await expect(api.find("post", {}, { with: { author: 5 } })).rejects.toThrow(/must be true, an array/);
          await expect(api.find("post", {}, { with: [5] })).rejects.toThrow(/relation names or objects/);
        });
        expect(queries).toHaveLength(0);
      }));

    it("an empty `with` loads nothing and `with: false` entries are skipped", () =>
      setup(async (api, db) => {
        const { queries } = await captureQueries(db, async () => {
          await api.find("post", {}, { with: [] });
          await api.find("post", {}, { with: {} });
          await api.find("post", {}, { with: { author: false } });
        });
        expect(selects(queries)).toHaveLength(3);
      }));
  });

  describe("no N+1", () => {
    it("the number of statements depends on the shape of the request, not on the number of rows", () =>
      run(async (db) => {
        const api = await makeApi(surface, db);
        const options = { with: { author: { select: ["firstName"] }, tags: ["name"], comments: { select: ["body"], with: { user: ["firstName"] } } } };

        await seedMany(db, 3);
        const small = await captureQueries(db, () => api.find("post", {}, options));
        await db("post_tag").del(); await db("comment").del(); await db("post").del();
        await seedManyMore(db, 60);
        const large = await captureQueries(db, () => api.find("post", {}, options));

        expect(large.result).toHaveLength(60);
        expect(selects(large.queries).length).toBe(selects(small.queries).length);
        expect(selects(large.queries)).toHaveLength(6); // posts, author, comments, comment users, pivot, tags
      }));
  });
});

// seedMany() inserts authors/tags too; once they exist only posts, comments and links are new.
async function seedManyMore(db, n) {
  const posts = [], comments = [], links = [];
  for (let i = 1; i <= n; i++) {
    posts.push({ id: i, authorId: (i % 2) + 1, title: `P${i}`, views: i });
    comments.push({ id: i * 2 - 1, postId: i, userId: 1, body: `a${i}` }, { id: i * 2, postId: i, userId: 2, body: `b${i}` });
    links.push({ post_id: i, tag_id: 1 }, { post_id: i, tag_id: 2 });
  }
  await insertRows(db, "post", posts);
  await insertRows(db, "comment", comments);
  await db("post_tag").insert(links);
}

describe.each(eachIsolatedDialect())("select on a plain Repository: load() - $name", ({ run }) => {
  it("narrows a lazily loaded relation, and says which field to add when the join key is missing", () =>
    run(async (db) => {
      const api = await makeApi("repository", db);
      await seed(db);

      const full = await api.findOne("post", { id: 1 });
      const author = await api.repo("post").load(full, "author", { select: ["email"] });
      expect(keys(author)).toEqual(["email"]);

      const slim = await api.findOne("post", { id: 1 }, { select: ["title"] });
      await expect(api.repo("post").load(slim, "author")).rejects.toThrow(/"authorId" was not loaded.*Add "authorId" to the select/);

      const nested = await api.repo("post").load(await api.findOne("post", { id: 1 }), "comments", { select: ["body"], with: ["user"] });
      expect(nested.map((c) => keys(c))).toEqual([["body", "user"], ["body", "user"]]);
    }));
});
