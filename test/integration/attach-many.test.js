import { describe, it, expect } from "vitest";
import { eachIsolatedDialect } from "../helpers/isolated-dialects.js";
import { captureQueries } from "../helpers/sql-capture.js";
import { buildBlogRegistry, dataStatements } from "../helpers/blog-fixture.js";
import { sync } from "../../src/schema/sync.js";
import { OrmClient } from "../../src/client/orm-client.js";
import { HookRegistry } from "../../src/uow/hooks.js";
import { RelationError } from "../../src/relations/errors.js";
import { rowsPerStatement } from "../../src/crud/insert-many.js";

const count = async (db, table) => Number((await db(table).count({ c: "*" }))[0].c);

async function setup(db, { posts = 0, tags = 0 } = {}) {
  const registry = buildBlogRegistry();
  await sync(db, registry);
  const client = new OrmClient(db, registry, new HookRegistry());
  if (posts) await client.models.post.createMany(Array.from({ length: posts }, (_, i) => ({ id: i + 1, title: `p${i + 1}` })));
  if (tags) await client.models.tag.createMany(Array.from({ length: tags }, (_, i) => ({ id: i + 1, name: `t${i + 1}` })));
  return client;
}

describe.each(eachIsolatedDialect())("attachMany - $name", ({ run }) => {
  it("associates many sources with their targets and reports how many were new", () =>
    run(async (db) => {
      const client = await setup(db, { posts: 3, tags: 4 });
      const inserted = await client.models.post.attachMany("tags", [
        { source: 1, targets: [1, 2] },
        { source: 2, targets: 3 }, // a single target needn't be wrapped
        { source: 3, targets: [] }, // nothing to do
      ]);
      expect(inserted).toBe(3);

      const pairs = (await db("post_tag").select("post_id", "tag_id")).map((r) => `${r.post_id}:${r.tag_id}`).sort();
      expect(pairs).toEqual(["1:1", "1:2", "2:3"]);
    }));

  it("accepts entities as well as raw ids for `source`", () =>
    run(async (db) => {
      const client = await setup(db, { posts: 2, tags: 2 });
      const [first] = await client.models.post.find({ id: 1 });
      await client.models.post.attachMany("tags", [
        { source: first, targets: [1] },
        { source: 2, targets: [2] },
      ]);
      expect(await count(db, "post_tag")).toBe(2);
    }));

  it("leaves existing associations alone and collapses duplicates, like attach()", () =>
    run(async (db) => {
      const client = await setup(db, { posts: 2, tags: 3 });
      await client.models.post.attach(1, "tags", [1]);

      const inserted = await client.models.post.attachMany("tags", [
        { source: 1, targets: [1, 2, 2] }, // (1,1) exists; (1,2) given twice
        { source: 1, targets: [2, 3] }, // (1,2) again
        { source: 2, targets: [1] },
      ]);
      expect(inserted).toBe(3); // (1,2), (1,3), (2,1)
      expect(await count(db, "post_tag")).toBe(4);

      expect(await client.models.post.attachMany("tags", [{ source: 1, targets: [1, 2, 3] }])).toBe(0); // idempotent
    }));

  it("treats 5 and \"5\" as the same target (attach() used to insert both and hit the unique key)", () =>
    run(async (db) => {
      const client = await setup(db, { posts: 1, tags: 5 });
      expect(await client.models.post.attach(1, "tags", [5])).toBe(1);
      expect(await client.models.post.attach(1, "tags", ["5"])).toBe(0);
      expect(await client.models.post.attachMany("tags", [{ source: 1, targets: ["5"] }])).toBe(0);
      expect(await count(db, "post_tag")).toBe(1);
    }));

  it("costs the same number of statements for 5 sources as for 200 (a check and an insert)", () =>
    run(async (db) => {
      const client = await setup(db, { posts: 200, tags: 3 });
      const links = (n) => Array.from({ length: n }, (_, i) => ({ source: i + 1, targets: [1, 2] }));

      const small = await captureQueries(db, () => client.models.post.attachMany("tags", links(5)));
      const large = await captureQueries(db, () => client.models.post.attachMany("tags", links(200)));
      expect(dataStatements(small.queries)).toHaveLength(2);
      expect(dataStatements(large.queries)).toHaveLength(2);
      expect(await count(db, "post_tag")).toBe(400);
    }));

  it("versus calling attach() in a loop, which costs two statements per source", () =>
    run(async (db) => {
      const client = await setup(db, { posts: 30, tags: 2 });
      const loop = await captureQueries(db, async () => {
        for (let id = 1; id <= 30; id++) await client.models.post.attach(id, "tags", [1, 2]);
      });
      expect(dataStatements(loop.queries)).toHaveLength(60);
    }));

  it("chunks very large batches across statements without losing or duplicating a pair", () =>
    run(async (db) => {
      const posts = 800;
      const client = await setup(db, { posts, tags: 2 });
      const links = Array.from({ length: posts }, (_, i) => ({ source: i + 1, targets: [1, 2] }));

      const perStatement = rowsPerStatement(db, 2);
      const { queries } = await captureQueries(db, () => client.models.post.attachMany("tags", links));

      const inserts = dataStatements(queries).filter((q) => /^insert/i.test(q.sql));
      expect(inserts).toHaveLength(Math.ceil((posts * 2) / perStatement));
      expect(await count(db, "post_tag")).toBe(posts * 2);

      // and re-running it finds them all already there, across the chunked existence check too
      expect(await client.models.post.attachMany("tags", links)).toBe(0);
    }));

  it("issues no SQL for an empty list", () =>
    run(async (db) => {
      const client = await setup(db, { posts: 1, tags: 1 });
      const { queries, result } = await captureQueries(db, () => client.models.post.attachMany("tags", []));
      expect(result).toBe(0);
      expect(queries).toHaveLength(0);
    }));

  it("rolls back with a surrounding client.transaction()", () =>
    run(async (db) => {
      const client = await setup(db, { posts: 2, tags: 2 });
      await expect(
        client.transaction(async (tx) => {
          await tx.models.post.attachMany("tags", [{ source: 1, targets: [1, 2] }]);
          throw new Error("abort");
        })
      ).rejects.toThrow("abort");
      expect(await count(db, "post_tag")).toBe(0);
    }));

  it("validates its input", () =>
    run(async (db) => {
      const client = await setup(db, { posts: 1, tags: 1 });
      await expect(client.models.post.attachMany("tags", { source: 1, targets: [1] })).rejects.toThrow(TypeError);
      await expect(client.models.post.attachMany("tags", [{ source: 1 }])).rejects.toThrow(/`source` and `targets`/);
      await expect(client.models.post.attachMany("tags", [{ source: {}, targets: [1] }])).rejects.toThrow(RelationError);
      await expect(client.models.post.attachMany("nope", [{ source: 1, targets: [1] }])).rejects.toThrow(/Unknown relation/);
      await expect(client.models.post.attachMany("comments", [{ source: 1, targets: [1] }])).rejects.toThrow(/belongsToMany/);
    }));
});
