import { describe, it, expect, beforeEach } from "vitest";
import { eachIsolatedDialect } from "../helpers/isolated-dialects.js";
import { captureQueries } from "../helpers/sql-capture.js";
import { BLOG_MODELS, buildBlogRegistry, dataStatements } from "../helpers/blog-fixture.js";
import { sync } from "../../src/schema/sync.js";
import { OrmClient } from "../../src/client/orm-client.js";
import { HookRegistry } from "../../src/uow/hooks.js";
import { Command } from "../../src/relations/commands.js";
import { ValidationError } from "../../src/crud/errors.js";
import { connect, createModel, syncModels, transaction, __resetGlobalStateForTests } from "../../src/global/index.js";

const count = async (db, table) => Number((await db(table).count({ c: "*" }))[0].c);

async function setupClient(db, hooks = new HookRegistry()) {
  const registry = buildBlogRegistry();
  await sync(db, registry);
  return new OrmClient(db, registry, hooks);
}

describe.each(eachIsolatedDialect())("client.models.<name>.createMany - $name", ({ run }) => {
  it("returns tracked entities: same instances find() gives back, with working save()", () =>
    run(async (db) => {
      const client = await setupClient(db);
      const posts = await client.models.post.createMany([
        { id: 1, title: "one" },
        { id: 2, title: "two" },
      ]);

      expect(posts.map((p) => p.title)).toEqual(["one", "two"]);
      const found = await client.models.post.findOne({ id: 2 });
      expect(found).toBe(posts[1]); // identity map, exactly like create()

      posts[1].title = "renamed";
      await posts[1].save();
      expect((await db("post").where({ id: 2 }).first()).title).toBe("renamed");
    }));

  it("creates nested children as tracked entities too", () =>
    run(async (db) => {
      const client = await setupClient(db);
      await client.models.post.createMany([
        { id: 1, title: "p", comments: [Command.create({ id: 10, body: "hi" })] },
      ]);
      expect(client.unitOfWork.identityMap.has("post:1")).toBe(true);
      expect(client.unitOfWork.identityMap.has("comment:10")).toBe(true);

      const comment = await client.models.comment.findOne({ id: 10 });
      comment.body = "edited";
      await comment.save(); // a real, dirty-tracked entity
      expect((await db("comment").where({ id: 10 }).first()).body).toBe("edited");
    }));

  it("create() with relation values returns the parent entity and writes the relations", () =>
    run(async (db) => {
      const client = await setupClient(db);
      const post = await client.models.post.create({ id: 1, title: "p", comments: [Command.create({ id: 1 })] });
      expect(post.id).toBe(1);
      expect(await count(db, "comment")).toBe(1);
    }));

  it("still issues a single INSERT for a plain create()", () =>
    run(async (db) => {
      const client = await setupClient(db);
      const { queries } = await captureQueries(db, () => client.models.post.create({ id: 1, title: "p" }));
      expect(dataStatements(queries)).toHaveLength(1);
    }));
});

describe.each(eachIsolatedDialect())("createMany - hooks - $name", ({ run }) => {
  it("runs before-hooks for every row (children after their parent exists), then after-hooks post-commit, parents first", () =>
    run(async (db) => {
      const hooks = new HookRegistry();
      const log = [];
      hooks.on("post", "beforeCreate", (data) => log.push(`before post ${data.id}`));
      hooks.on("post", "beforeSave", (data) => log.push(`beforeSave post ${data.id}`));
      hooks.on("comment", "beforeCreate", (data) => log.push(`before comment ${data.id} (postId ${data.postId})`));
      hooks.on("post", "afterCreate", (entity) => log.push(`after post ${entity.id}`));
      hooks.on("post", "afterSave", (entity) => log.push(`afterSave post ${entity.id}`));
      hooks.on("comment", "afterCreate", (entity) => log.push(`after comment ${entity.id}`));

      const client = await setupClient(db, hooks);
      await client.models.post.createMany([
        { id: 1, title: "a", comments: [Command.create({ id: 10 })] },
        { id: 2, title: "b", comments: [Command.create({ id: 11 })] },
      ]);

      expect(log).toEqual([
        // phase 1 - before anything is written, every top-level row
        "before post 1",
        "beforeSave post 1",
        "before post 2",
        "beforeSave post 2",
        // phase 2 - children are prepared once their parent row (and so their foreign key) exists
        "before comment 10 (postId 1)",
        "before comment 11 (postId 2)",
        // phase 3 - after commit
        "after post 1",
        "afterSave post 1",
        "after post 2",
        "afterSave post 2",
        "after comment 10",
        "after comment 11",
      ]);
    }));

  it("top-level before-hooks run before anything is written", () =>
    run(async (db) => {
      const hooks = new HookRegistry();
      const rowsSeenByHooks = [];
      hooks.on("post", "beforeCreate", async () => {
        rowsSeenByHooks.push(await count(db, "post"));
      });
      const client = await setupClient(db, hooks);

      await client.models.post.createMany([
        { id: 1, title: "a" },
        { id: 2, title: "b" },
        { id: 3, title: "c" },
      ]);
      expect(rowsSeenByHooks).toEqual([0, 0, 0]); // not 0, 1, 2 as a one-at-a-time loop would show
    }));

  it("lets a beforeCreate hook mutate the data, for top-level rows and nested children alike", () =>
    run(async (db) => {
      const hooks = new HookRegistry();
      hooks.on("post", "beforeCreate", (data) => (data.title = data.title.toUpperCase()));
      hooks.on("comment", "beforeCreate", (data) => (data.body = `[${data.body}]`));
      const client = await setupClient(db, hooks);

      const commentValues = { id: 1, body: "hi" };
      const command = Command.create(commentValues);
      await client.models.post.createMany([{ id: 1, title: "shout", comments: [command] }]);

      expect((await db("post").first()).title).toBe("SHOUT");
      expect((await db("comment").first()).body).toBe("[hi]");
      expect(commentValues.body).toBe("hi"); // the caller's Command values aren't mutated behind their back
    }));

  it("a throwing before-hook on a later row aborts the whole batch before any write", () =>
    run(async (db) => {
      const hooks = new HookRegistry();
      hooks.on("post", "beforeCreate", (data) => {
        if (data.id === 3) throw new Error("no row 3");
      });
      const client = await setupClient(db, hooks);

      const { queries, result } = await captureQueries(db, () =>
        client.models.post
          .createMany([
            { id: 1, title: "a" },
            { id: 2, title: "b" },
            { id: 3, title: "c" },
          ])
          .catch((e) => e)
      );
      expect(result.message).toBe("no row 3");
      expect(queries).toHaveLength(0);
    }));

  it("fires no after-hooks and tracks no entities when the write fails", () =>
    run(async (db) => {
      const hooks = new HookRegistry();
      const fired = [];
      hooks.on("tag", "afterCreate", (entity) => fired.push(entity.id));
      const client = await setupClient(db, hooks);

      await expect(
        client.models.tag.createMany([
          { id: 1, name: "same" },
          { id: 2, name: "same" }, // unique violation
        ])
      ).rejects.toThrow();

      expect(fired).toEqual([]);
      expect(client.unitOfWork.identityMap.size).toBe(0);
      expect(await count(db, "tag")).toBe(0);
    }));

  it("keeps a plain create()'s hook order unchanged: before, before-save, insert, after, after-save", () =>
    run(async (db) => {
      const hooks = new HookRegistry();
      const log = [];
      for (const name of ["beforeCreate", "beforeSave", "afterCreate", "afterSave"]) hooks.on("post", name, () => log.push(name));
      const client = await setupClient(db, hooks);

      await client.models.post.create({ id: 1, title: "p" });
      expect(log).toEqual(["beforeCreate", "beforeSave", "afterCreate", "afterSave"]);
    }));
});

describe.each(eachIsolatedDialect())("client.transaction with createMany - $name", ({ run }) => {
  it("rolls back a whole nested batch together with the surrounding transaction", () =>
    run(async (db) => {
      const client = await setupClient(db);

      await expect(
        client.transaction(async (tx) => {
          await tx.models.tag.create({ id: 1, name: "t" });
          await tx.models.post.createMany([
            { id: 1, title: "p", tags: [1], comments: [Command.create({ id: 1 })] },
            { id: 2, title: "q", tags: [1] },
          ]);
          throw new Error("abort");
        })
      ).rejects.toThrow("abort");

      for (const table of ["post", "tag", "comment", "post_tag"]) expect(await count(db, table)).toBe(0);
    }));

  it("commits when the surrounding transaction does, without nesting its own", () =>
    run(async (db) => {
      const client = await setupClient(db);
      const { queries } = await captureQueries(db, () =>
        client.transaction((tx) =>
          tx.models.post.createMany([{ id: 1, title: "p", comments: [Command.create({ id: 1 })] }])
        )
      );
      expect(queries.filter((q) => /savepoint/i.test(q.sql))).toHaveLength(0);
      expect(queries.filter((q) => /^begin/i.test(q.sql))).toHaveLength(1);
      expect(await count(db, "comment")).toBe(1);
    }));
});

describe.each(eachIsolatedDialect())("global createModel() API: createMany and nested creation - $name", ({ run }) => {
  beforeEach(() => __resetGlobalStateForTests());

  function defineGlobalModels(hooksByModel = {}) {
    const models = {};
    for (const { name, fields, relations } of BLOG_MODELS) {
      models[name] = createModel(name, { fields, relations, hooks: hooksByModel[name] });
    }
    return models;
  }

  it("createMany returns documents with their own save()/delete()", () =>
    run(async (db) => {
      connect(db);
      const { post } = defineGlobalModels();
      await syncModels();

      const posts = await post.createMany([
        { id: 1, title: "a" },
        { id: 2, title: "b" },
      ]);
      expect(posts).toHaveLength(2);
      posts[0].title = "renamed";
      await posts[0].save();
      expect((await db("post").where({ id: 1 }).first()).title).toBe("renamed");
    }));

  it("hands nested children to their own model's hooks, as documents of that model", () =>
    run(async (db) => {
      connect(db);
      const seen = [];
      const { post } = defineGlobalModels({
        comment: {
          beforeCreate: (data) => seen.push(`before postId=${data.postId}`),
          afterCreate: (doc) => seen.push(`after id=${doc.id} save=${typeof doc.save}`),
        },
      });
      await syncModels();

      await post.createMany([{ id: 7, title: "p", comments: [Command.create({ id: 70, body: "x" })] }]);
      expect(seen).toEqual(["before postId=7", "after id=70 save=function"]);
    }));

  it("create() accepts relation values, and { trx } from transaction() rolls everything back", () =>
    run(async (db) => {
      connect(db);
      const { post, tag } = defineGlobalModels();
      await syncModels();
      await tag.create({ id: 1, name: "t" });

      await post.create({ id: 1, title: "kept", tags: [1], comments: [Command.create({ id: 1 })] });
      expect(await count(db, "post_tag")).toBe(1);

      await expect(
        transaction(async (trx) => {
          await post.createMany([{ id: 2, title: "x", tags: [1] }], { trx });
          throw new Error("abort");
        })
      ).rejects.toThrow("abort");
      expect(await count(db, "post")).toBe(1); // only "kept"
      expect(await count(db, "post_tag")).toBe(1);
    }));

  it("keeps query count flat across row counts, same as the other surfaces", () =>
    run(async (db) => {
      connect(db);
      const { post } = defineGlobalModels();
      await syncModels();

      const rows = (start, n) =>
        Array.from({ length: n }, (_, i) => ({ id: start + i, title: "p", comments: [Command.create({ id: start + i })] }));
      const small = await captureQueries(db, () => post.createMany(rows(1, 3)));
      const large = await captureQueries(db, () => post.createMany(rows(100, 80)));
      expect(dataStatements(large.queries).length).toBe(dataStatements(small.queries).length);
      expect(dataStatements(large.queries).length).toBe(2); // post insert + comment insert
    }));

  it("reports validation errors as ValidationError with row paths", () =>
    run(async (db) => {
      connect(db);
      const { post } = defineGlobalModels();
      await syncModels();
      const err = await post.createMany([{ id: 1, title: "ok" }, { id: 2 }]).catch((e) => e);
      expect(err).toBeInstanceOf(ValidationError);
      expect(Object.keys(err.fieldErrors)).toEqual(["[1].title"]);
    }));
});
