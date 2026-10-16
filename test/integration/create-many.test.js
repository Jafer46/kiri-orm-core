import { describe, it, expect } from "vitest";
import { eachIsolatedDialect } from "../helpers/isolated-dialects.js";
import { captureQueries } from "../helpers/sql-capture.js";
import { buildBlogRegistry, dataStatements } from "../helpers/blog-fixture.js";
import { sync } from "../../src/schema/sync.js";
import { RepositoryFactory } from "../../src/crud/repository-factory.js";
import { Repository } from "../../src/crud/repository.js";
import { ValidationError } from "../../src/crud/errors.js";
import { RelationError } from "../../src/relations/errors.js";
import { rowsPerStatement } from "../../src/crud/insert-many.js";
import { Command } from "../../src/relations/commands.js";

async function setup(db) {
  const registry = buildBlogRegistry();
  await sync(db, registry);
  return { registry, repos: new RepositoryFactory(db, registry) };
}

const count = async (db, table) => Number((await db(table).count({ c: "*" }))[0].c);

const byId = (rows) => [...rows].sort((a, b) => a.id - b.id);

describe.each(eachIsolatedDialect())("createMany - plain rows - $name", ({ run }) => {
  it("returns stored records in input order, with defaults applied and values cast", () =>
    run(async (db) => {
      const { repos } = await setup(db);
      const when = new Date("2026-03-01T10:00:00.000Z");

      const created = await repos.for("post").createMany([
        { id: 3, title: "Third", meta: { tags: ["a"] }, publishedAt: when, featured: true },
        { id: 1, title: "First" },
        { id: 2, title: "Second", views: "7" }, // numeric string is cast, like create()
      ]);

      expect(created.map((p) => p.id)).toEqual([3, 1, 2]); // input order, not id order
      expect(created[0].meta).toEqual({ tags: ["a"] });
      expect(created[0].publishedAt.getTime()).toBe(when.getTime());
      expect(created[0].featured).toBe(true);
      expect(created[1].views).toBe(0); // default
      expect(created[1].featured).toBe(false); // default
      expect(created[2].views).toBe(7); // cast
    }));

  it("round-trips objects, arrays, numbers, booleans and null through a multi-row insert", () =>
    run(async (db) => {
      const { repos } = await setup(db);
      // A multi-row INSERT is where Knex-on-SQLite stops serializing objects for you,
      // and where the pg driver would turn an array into a Postgres array literal.
      // (A top-level JSON *string* is left out on purpose: fromRow() can't tell a parsed
      // string from unparsed JSON text on Postgres - an existing limitation of find() too.)
      const metas = [{ nested: { list: [1, 2, { deep: true }] } }, [1, "two", null], 42, true, null];
      const created = await repos.for("post").createMany(metas.map((meta, i) => ({ id: i + 1, title: `p${i}`, meta })));

      expect(created.map((p) => p.meta)).toEqual(metas);
      const reread = byId(await repos.for("post").find());
      expect(reread.map((p) => p.meta)).toEqual(metas);
    }));

  it("returns [] and issues no SQL for an empty list", () =>
    run(async (db) => {
      const { repos } = await setup(db);
      const { queries, result } = await captureQueries(db, () => repos.for("post").createMany([]));
      expect(result).toEqual([]);
      expect(queries).toHaveLength(0);
    }));

  it("uses exactly one INSERT, and no transaction, when everything fits in one statement", () =>
    run(async (db) => {
      const { repos } = await setup(db);
      const { queries } = await captureQueries(db, () =>
        repos.for("post").createMany(Array.from({ length: 20 }, (_, i) => ({ id: i + 1, title: `p${i + 1}` })))
      );
      // Not even BEGIN/COMMIT. (On Postgres, explicit ids add one setval before the INSERT -
      // bookkeeping for the sequence, not a data statement; see dataStatements().)
      expect(dataStatements(queries)).toHaveLength(1);
      expect(dataStatements(queries)[0].sql).toMatch(/^insert into/i);
      expect(queries.filter(({ sql }) => /^\s*(begin|commit)/i.test(sql))).toHaveLength(0);
    }));

  it("chunks a large batch to the dialect's limit and keeps every row and its order", () =>
    run(async (db) => {
      const { registry, repos } = await setup(db);
      const total = 1200;
      const perStatement = rowsPerStatement(db, Object.keys(registry.getModel("post").fields).length);
      expect(perStatement).toBeLessThan(total); // the test is only meaningful if it must chunk

      const rows = Array.from({ length: total }, (_, i) => ({ id: i + 1, title: `p${i + 1}` }));
      const { queries, result } = await captureQueries(db, () => repos.for("post").createMany(rows));

      expect(dataStatements(queries)).toHaveLength(Math.ceil(total / perStatement));
      expect(result.map((p) => p.id)).toEqual(rows.map((r) => r.id));
      expect(await count(db, "post")).toBe(total);
    }));

  it("honors a smaller chunkSize but never a larger one than the dialect allows", () =>
    run(async (db) => {
      const { repos } = await setup(db);
      const rows = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, title: `p${i + 1}` }));

      const small = await captureQueries(db, () => repos.for("post").createMany(rows, { chunkSize: 3 }));
      expect(dataStatements(small.queries)).toHaveLength(4); // 3+3+3+1

      await db("post").delete();
      const huge = await captureQueries(db, () => repos.for("post").createMany(rows, { chunkSize: 1_000_000 }));
      expect(dataStatements(huge.queries)).toHaveLength(1);
    }));

  it("is atomic across chunks: a failure in a later chunk leaves nothing behind", () =>
    run(async (db) => {
      const { repos } = await setup(db);
      // chunkSize 2 -> chunks [a,b] [c,d] [e]. "dup" appears in chunk 1 and chunk 2,
      // so the DB (unique tag.name) rejects chunk 2 AFTER chunk 1 has been inserted.
      const rows = ["a", "dup", "c", "dup", "e"].map((name, i) => ({ id: i + 1, name }));

      await expect(repos.for("tag").createMany(rows, { chunkSize: 2 })).rejects.toThrow();
      expect(await count(db, "tag")).toBe(0);
    }));

  it("joins an existing transaction when given { trx }, so the caller controls rollback", () =>
    run(async (db) => {
      const { repos } = await setup(db);
      const rows = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, title: `p${i + 1}` }));

      await expect(
        db.transaction(async (trx) => {
          await repos.for("post").createMany(rows, { trx });
          expect(await count(trx, "post")).toBe(5); // visible inside
          throw new Error("outer failure");
        })
      ).rejects.toThrow("outer failure");
      expect(await count(db, "post")).toBe(0); // gone

      await db.transaction((trx) => repos.for("post").createMany(rows, { trx }));
      expect(await count(db, "post")).toBe(5);
    }));
});

describe.each(eachIsolatedDialect())("createMany - validation - $name", ({ run }) => {
  it("validates every row before writing anything, reporting errors per row", () =>
    run(async (db) => {
      const { repos } = await setup(db);
      const { queries, result } = await captureQueries(db, async () => {
        try {
          await repos.for("post").createMany([
            { id: 1, title: "ok" },
            { id: 2 }, // title missing
            { id: 3, title: "x".repeat(61) }, // too long
            { id: 4, title: "fine", nope: true }, // unknown field
          ]);
        } catch (err) {
          return err;
        }
      });

      expect(result).toBeInstanceOf(ValidationError);
      expect(Object.keys(result.fieldErrors).sort()).toEqual(["[1].title", "[2].title", "[3].nope"]);
      expect(queries).toHaveLength(0); // row 0 was fine, but nothing was written
    }));

  it("stops collecting after 20 invalid rows instead of reporting all of them", () =>
    run(async (db) => {
      const { repos } = await setup(db);
      const rows = Array.from({ length: 500 }, (_, i) => ({ id: i + 1 })); // every title missing

      const err = await repos.for("post").createMany(rows).catch((e) => e);
      expect(err).toBeInstanceOf(ValidationError);
      const rowKeys = Object.keys(err.fieldErrors).filter((k) => k.startsWith("["));
      expect(rowKeys).toHaveLength(20);
      expect(err.fieldErrors._[0]).toMatch(/stopped after 20/);
    }));

  it("keeps create()'s plain field-name error keys (no row prefix)", () =>
    run(async (db) => {
      const { repos } = await setup(db);
      const err = await repos.for("post").create({ id: 1 }).catch((e) => e);
      expect(err).toBeInstanceOf(ValidationError);
      expect(Object.keys(err.fieldErrors)).toEqual(["title"]);
    }));

  it("rejects a non-array argument and non-object entries with a TypeError", () =>
    run(async (db) => {
      const { repos } = await setup(db);
      await expect(repos.for("post").createMany({ id: 1, title: "x" })).rejects.toThrow(TypeError);
      await expect(repos.for("post").createMany([{ id: 1, title: "x" }, null])).rejects.toThrow(/entry \[1\] must be an object/);
    }));
});

describe.each(eachIsolatedDialect())("createMany - relations - $name", ({ run }) => {
  it("hasMany: Command.create writes each parent's children with the foreign key filled in", () =>
    run(async (db) => {
      const { repos } = await setup(db);
      await repos.for("post").createMany([
        { id: 1, title: "one", comments: [Command.create({ id: 10, body: "a" }), Command.create({ id: 11, body: "b" })] },
        { id: 2, title: "two", comments: [Command.create({ id: 20, body: "c" })] },
        { id: 3, title: "no comments" },
      ]);

      const comments = byId(await repos.for("comment").find());
      expect(comments.map((c) => [c.id, c.postId, c.body])).toEqual([
        [10, 1, "a"],
        [11, 1, "b"],
        [20, 2, "c"],
      ]);
    }));

  it("belongsToMany: bare ids, Command.link and Command.set all associate existing records", () =>
    run(async (db) => {
      const { repos } = await setup(db);
      await repos.for("tag").createMany([1, 2, 3, 4].map((id) => ({ id, name: `t${id}` })));

      await repos.for("post").createMany([
        { id: 1, title: "ids", tags: [1, 2] },
        { id: 2, title: "link", tags: [Command.link(2), Command.link(3)] },
        { id: 3, title: "set", tags: [Command.set([3, 4])] },
        { id: 4, title: "mixed", tags: [1, Command.link(4), Command.set([2])] },
      ]);

      const pivot = await db("post_tag").select("post_id", "tag_id");
      const grouped = {};
      for (const row of pivot) (grouped[row.post_id] ??= []).push(row.tag_id);
      for (const key of Object.keys(grouped)) grouped[key].sort();
      expect(grouped).toEqual({ 1: [1, 2], 2: [2, 3], 3: [3, 4], 4: [1, 2, 4] });
    }));

  it("belongsToMany: Command.create makes the related record and associates it, alongside links", () =>
    run(async (db) => {
      const { repos } = await setup(db);
      await repos.for("tag").create({ id: 1, name: "existing" });

      await repos.for("post").createMany([
        { id: 1, title: "p1", tags: [1, Command.create({ id: 2, name: "new-a" })] },
        { id: 2, title: "p2", tags: [Command.create({ id: 3, name: "new-b" }), Command.create({ id: 4, name: "new-c" })] },
      ]);

      expect(byId(await repos.for("tag").find()).map((t) => t.name)).toEqual(["existing", "new-a", "new-b", "new-c"]);
      const pivot = (await db("post_tag").select("post_id", "tag_id")).map((r) => `${r.post_id}:${r.tag_id}`).sort();
      expect(pivot).toEqual(["1:1", "1:2", "2:3", "2:4"]);
    }));

  it("collapses a repeated id in one relation value instead of failing on the pivot's unique key", () =>
    run(async (db) => {
      const { repos } = await setup(db);
      await repos.for("tag").create({ id: 1, name: "t" });
      await repos.for("post").createMany([{ id: 1, title: "p", tags: [1, 1, Command.link(1), Command.set([1])] }]);
      expect(await count(db, "post_tag")).toBe(1);
    }));

  it("nests to any depth: post -> comments -> reactions, plus tags created at the top", () =>
    run(async (db) => {
      const { repos } = await setup(db);
      await repos.for("post").createMany([
        {
          id: 1,
          title: "deep",
          tags: [Command.create({ id: 1, name: "t" })],
          comments: [
            Command.create({ id: 10, body: "c10", reactions: [Command.create({ id: 100, emoji: "+1" }), Command.create({ id: 101, emoji: "ok" })] }),
            Command.create({ id: 11, body: "c11", reactions: [Command.create({ id: 102, emoji: "wow" })] }),
          ],
        },
        { id: 2, title: "deep2", comments: [Command.create({ id: 20, body: "c20", reactions: [Command.create({ id: 103, emoji: "hi" })] })] },
      ]);

      const reactions = byId(await repos.for("reaction").find());
      expect(reactions.map((r) => [r.id, r.commentId])).toEqual([
        [100, 10],
        [101, 10],
        [102, 11],
        [103, 20],
      ]);
    }));

  it("hasMany: Command.link re-points existing children at the new parent", () =>
    run(async (db) => {
      const { repos } = await setup(db);
      await repos.for("post").create({ id: 99, title: "old home" });
      await repos.for("comment").createMany([
        { id: 1, postId: 99 },
        { id: 2, postId: 99 },
        { id: 3, postId: 99 },
      ]);

      await repos.for("post").createMany([
        { id: 1, title: "adopts 1,2", comments: [Command.link(1), Command.link(2)] },
        { id: 2, title: "adopts 3", comments: [3] },
      ]);

      expect(byId(await repos.for("comment").find()).map((c) => [c.id, c.postId])).toEqual([
        [1, 1],
        [2, 1],
        [3, 2],
      ]);
    }));

  it("hasMany: linking an id that doesn't exist fails and rolls the whole batch back", () =>
    run(async (db) => {
      const { repos } = await setup(db);
      await repos.for("comment").create({ id: 1, postId: 99 });

      const err = await repos
        .for("post")
        .createMany([{ id: 1, title: "p", comments: [Command.link(1), Command.link(404)] }])
        .catch((e) => e);

      expect(err).toBeInstanceOf(RelationError);
      expect(err.message).toMatch(/matched 1 of 2/);
      expect(await count(db, "post")).toBe(0);
      expect((await repos.for("comment").findOne({ id: 1 })).postId).toBe(99); // untouched
    }));

  it("an explicit foreign key on a nested child must agree with its parent", () =>
    run(async (db) => {
      const { repos } = await setup(db);

      const bad = await repos
        .for("post")
        .createMany([{ id: 1, title: "p", comments: [Command.create({ id: 1, postId: 2 })] }])
        .catch((e) => e);
      expect(bad).toBeInstanceOf(RelationError);
      expect(bad.message).toMatch(/belongs to parent 1/);
      expect(await count(db, "post")).toBe(0);

      await repos.for("post").createMany([{ id: 1, title: "p", comments: [Command.create({ id: 1, postId: 1 })] }]); // redundant but consistent
      expect(await count(db, "comment")).toBe(1);
    }));

  it("a nested validation error is reported with its full path, and rolls back the parents", () =>
    run(async (db) => {
      const { repos } = await setup(db);
      const err = await repos
        .for("post")
        .createMany([
          { id: 1, title: "fine", comments: [Command.create({ id: 1, likes: 1 })] },
          { id: 2, title: "bad child", comments: [Command.create({ id: 2, likes: 1 }), Command.create({ id: 3, likes: -5 })] },
        ])
        .catch((e) => e);

      expect(err).toBeInstanceOf(ValidationError);
      expect(err.modelName).toBe("comment");
      expect(Object.keys(err.fieldErrors)).toEqual(["[1].comments[1].likes"]);
      expect(await count(db, "post")).toBe(0);
      expect(await count(db, "comment")).toBe(0);
    }));

  it("a database error while writing a relation rolls back everything, including parents", () =>
    run(async (db) => {
      const { repos } = await setup(db);
      const err = await repos
        .for("post")
        .createMany([
          { id: 1, title: "p1", tags: [Command.create({ id: 1, name: "same" })] },
          { id: 2, title: "p2", tags: [Command.create({ id: 2, name: "same" })] }, // unique tag.name violated
        ])
        .catch((e) => e);

      expect(err).toBeDefined();
      expect(await count(db, "post")).toBe(0);
      expect(await count(db, "tag")).toBe(0);
      expect(await count(db, "post_tag")).toBe(0);
    }));

  it("create() accepts relation values too, and nested errors keep their path", () =>
    run(async (db) => {
      const { repos } = await setup(db);
      const post = await repos.for("post").create({ id: 1, title: "single", comments: [Command.create({ id: 1, body: "hi" })], tags: [] });
      expect(post.id).toBe(1);
      expect(post).not.toHaveProperty("comments"); // the returned record is the row itself
      expect(await count(db, "comment")).toBe(1);

      const err = await repos.for("post").create({ id: 2, title: "x", comments: [Command.create({ id: 2, likes: -1 })] }).catch((e) => e);
      expect(Object.keys(err.fieldErrors)).toEqual(["comments[0].likes"]);
    }));

  it("an empty relation array is a no-op that doesn't open a transaction", () =>
    run(async (db) => {
      const { repos } = await setup(db);
      const { queries } = await captureQueries(db, () => repos.for("post").create({ id: 1, title: "p", comments: [], tags: [] }));
      expect(dataStatements(queries)).toHaveLength(1);
      expect(queries.filter(({ sql }) => /^\s*(begin|commit)/i.test(sql))).toHaveLength(0);
    }));
});

describe.each(eachIsolatedDialect())("createMany - unsupported / malformed relation payloads - $name", ({ run }) => {
  it("rejects a belongsTo key and points at the foreign key field instead", () =>
    run(async (db) => {
      const { repos } = await setup(db);
      const err = await repos.for("post").create({ id: 1, title: "p", author: 5 }).catch((e) => e);
      expect(err).toBeInstanceOf(RelationError);
      expect(err.message).toMatch(/belongsTo/);
      expect(err.message).toMatch(/"authorId"/);
    }));

  it("rejects a hasOne key clearly", () =>
    run(async (db) => {
      const { repos } = await setup(db);
      const err = await repos.for("post").create({ id: 1, title: "p", pinned: [1] }).catch((e) => e);
      expect(err).toBeInstanceOf(RelationError);
      expect(err.message).toMatch(/hasOne/);
    }));

  it("rejects a plain object entry rather than guessing it means 'create'", () =>
    run(async (db) => {
      const { repos } = await setup(db);
      const err = await repos.for("post").create({ id: 1, title: "p", comments: [{ id: 1, body: "x" }] }).catch((e) => e);
      expect(err).toBeInstanceOf(RelationError);
      expect(err.message).toMatch(/Command\.create/);
      expect(await count(db, "post")).toBe(0);
    }));

  it("rejects a non-array relation value", () =>
    run(async (db) => {
      const { repos } = await setup(db);
      const err = await repos.for("post").create({ id: 1, title: "p", tags: 3 }).catch((e) => e);
      expect(err).toBeInstanceOf(RelationError);
      expect(err.message).toMatch(/expects an array/);
    }));

  it("needs a modelRegistry to write relations, and says so before touching the DB", () =>
    run(async (db) => {
      const registry = buildBlogRegistry();
      await sync(db, registry);
      const bare = new Repository(db, registry.getModel("post")); // no modelRegistry

      const { queries, result } = await captureQueries(db, () =>
        bare.create({ id: 1, title: "p", comments: [Command.create({ id: 1 })] }).catch((e) => e)
      );
      expect(result).toBeInstanceOf(RelationError);
      expect(result.message).toMatch(/modelRegistry/);
      expect(queries).toHaveLength(0);

      // ...but it still bulk-creates plain rows fine
      expect(await bare.createMany([{ id: 2, title: "ok" }])).toHaveLength(1);
    }));
});

describe.each(eachIsolatedDialect())("createMany - query count does not grow with row count (the N+1 fix) - $name", ({ run }) => {
  async function statementsFor(n) {
    return run(async (db) => {
      const { repos } = await setup(db);
      await repos.for("tag").createMany([1, 2, 3].map((id) => ({ id, name: `t${id}` })));

      const rows = Array.from({ length: n }, (_, i) => ({
        id: i + 1,
        title: `p${i + 1}`,
        tags: [1, 2, Command.create({ id: 100 + i, name: `own-${i}` })],
        comments: [
          Command.create({ id: i * 2 + 1, body: "a", reactions: [Command.create({ id: i * 2 + 1, emoji: "+1" })] }),
          Command.create({ id: i * 2 + 2, body: "b" }),
        ],
      }));
      const { queries } = await captureQueries(db, () => repos.for("post").createMany(rows));

      // and it must have actually written the right amount
      expect(await count(db, "post")).toBe(n);
      expect(await count(db, "comment")).toBe(2 * n);
      expect(await count(db, "reaction")).toBe(n);
      expect(await count(db, "post_tag")).toBe(3 * n);
      return dataStatements(queries).length;
    });
  }

  it("issues the same number of statements for 3 rows as for 60", async () => {
    const small = await statementsFor(3);
    const large = await statementsFor(60);
    expect(large).toBe(small);
  });

  it("needs one statement per table written: post, tag, comment, reaction, post_tag", async () => {
    expect(await statementsFor(10)).toBe(5);
  });
});

describe.each(eachIsolatedDialect())("createMany - mapping results back to parents - $name", ({ run }) => {
  it("keeps every child attached to its own parent across a large, chunked batch", () =>
    run(async (db) => {
      const { repos } = await setup(db);
      const n = 700; // beyond SQLite's 500-row statement limit, so parents AND children span chunks
      await repos.for("post").createMany(
        Array.from({ length: n }, (_, i) => ({
          id: i + 1,
          title: `p${i + 1}`,
          comments: [Command.create({ id: i + 1, body: `for-${i + 1}` })],
        }))
      );

      const comments = await repos.for("comment").find();
      expect(comments).toHaveLength(n);
      // comment N was created for post N; any misalignment shows up here
      expect(comments.every((c) => c.postId === c.id && c.body === `for-${c.id}`)).toBe(true);
    }));
});
