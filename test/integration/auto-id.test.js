import { describe, it, expect } from "vitest";
import { eachIsolatedDialect } from "../helpers/isolated-dialects.js";
import { captureQueries } from "../helpers/sql-capture.js";
import { dataStatements } from "../helpers/blog-fixture.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRegistry } from "../../src/models/registry.js";
import { sync } from "../../src/schema/sync.js";
import { OrmClient } from "../../src/client/orm-client.js";
import { HookRegistry } from "../../src/uow/hooks.js";
import { ValidationError } from "../../src/crud/errors.js";
import { Command } from "../../src/relations/commands.js";
import { generateMigrationFile, migrateUp, migrateDown } from "../../src/migrations/runner.js";
import { generateDTOSchemas } from "../../src/dto/schema-generator.js";
import { connect, createModel, syncModels, __resetGlobalStateForTests } from "../../src/global/index.js";

const MODELS = [
  {
    name: "post",
    fields: { id: { type: "integer", required: true }, title: { type: "char" } },
    relations: { comments: { type: "hasMany", model: "comment", foreignKey: "postId" } },
  },
  { name: "comment", fields: { id: { type: "integer", required: true }, postId: { type: "integer", required: true }, body: { type: "char" } } },
  { name: "token", fields: { id: { type: "uuid", required: true }, label: { type: "char" } } },
  { name: "manual", fields: { id: { type: "integer", required: true, auto: false } } },
];

async function setup(db) {
  const registry = new ModelRegistry();
  for (const m of MODELS) registry.define(m);
  await sync(db, registry);
  return { registry, client: new OrmClient(db, registry, new HookRegistry()) };
}

describe.each(eachIsolatedDialect())("automatic ids - $name", ({ run }) => {
  it("integer id is assigned by the database, ascending, and returned on the record", () =>
    run(async (db) => {
      const { client } = await setup(db);
      const a = await client.models.post.create({ title: "a" });
      const b = await client.models.post.create({ title: "b" });
      expect(a.id).toBe(1);
      expect(b.id).toBe(2);
      expect((await client.models.post.findOne({ id: 2 })).title).toBe("b");
    }));

  it("the column is a real, non-null primary key", () =>
    run(async (db) => {
      const { client } = await setup(db);
      const info = await db("post").columnInfo();
      expect(info.id.nullable).toBe(false);
      await client.models.post.create({ id: 5, title: "x" });
      await expect(db("post").insert({ id: 5, title: "dup" })).rejects.toThrow(); // uniqueness is enforced now
    }));

  it("createMany assigns ids in input order, in a single statement", () =>
    run(async (db) => {
      const { client } = await setup(db);
      const { queries, result } = await captureQueries(db, () => client.models.post.createMany([{ title: "a" }, { title: "b" }, { title: "c" }]));
      expect(result.map((p) => [p.id, p.title])).toEqual([[1, "a"], [2, "b"], [3, "c"]]);
      expect(dataStatements(queries)).toHaveLength(1);
    }));

  it("explicit ids still work, and win", () =>
    run(async (db) => {
      const { client } = await setup(db);
      expect((await client.models.post.create({ id: 500, title: "x" })).id).toBe(500);
      const many = await client.models.post.createMany([{ id: 600, title: "y" }, { id: 601, title: "z" }]);
      expect(many.map((p) => p.id)).toEqual([600, 601]);
    }));

  it("a mixed batch (some explicit, some auto) works, keeping every row paired with its own input", () =>
    run(async (db) => {
      const { client } = await setup(db);
      const created = await client.models.post.createMany([{ id: 900, title: "explicit" }, { title: "auto" }]);
      expect(created.map((p) => p.title)).toEqual(["explicit", "auto"]);
      expect(created[0].id).toBe(900);
      expect(typeof created[1].id).toBe("number");
    }));

  it("nested Command.create children get their parent's generated id as foreign key", () =>
    run(async (db) => {
      const { client } = await setup(db);
      const posts = await client.models.post.createMany([
        { title: "p1", comments: [Command.create({ body: "c1" }), Command.create({ body: "c2" })] },
        { title: "p2", comments: [Command.create({ body: "c3" })] },
      ]);
      const rows = await db("comment").select("post_id", "body").orderBy("body");
      expect(rows).toEqual([
        { post_id: posts[0].id, body: "c1" },
        { post_id: posts[0].id, body: "c2" },
        { post_id: posts[1].id, body: "c3" },
      ]);
    }));

  it("belongsToMany and attach work with generated ids", () =>
    run(async (db) => {
      const registry = new ModelRegistry();
      registry.define({ name: "post", fields: { id: { type: "integer", required: true } }, relations: { tags: { type: "belongsToMany", model: "tag", through: "post_tag", foreignKey: "post_id", otherKey: "tag_id" } } });
      registry.define({ name: "tag", fields: { id: { type: "integer", required: true }, name: { type: "char" } } });
      await sync(db, registry);
      const client = new OrmClient(db, registry, new HookRegistry());
      const tag = await client.models.tag.create({ name: "t" });
      const post = await client.models.post.create({ tags: [tag.id] });
      expect(await db("post_tag").select("post_id", "tag_id")).toEqual([{ post_id: post.id, tag_id: tag.id }]);
    }));

  it("uuid id is generated per record, unique, valid, and round-trips", () =>
    run(async (db) => {
      const { client } = await setup(db);
      const [a, b] = await client.models.token.createMany([{ label: "a" }, { label: "b" }]);
      expect(a.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(a.id).not.toBe(b.id);
      expect((await client.models.token.findOne({ id: a.id })).label).toBe("a");
      expect(await client.models.token.deleteMany({ id: b.id })).toBe(1);
    }));

  it("a supplied uuid is kept (and normalized), an invalid one is rejected", () =>
    run(async (db) => {
      const { client } = await setup(db);
      const t = await client.models.token.create({ id: "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE", label: "x" });
      expect(t.id).toBe("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
      const err = await client.models.token.create({ id: "not-a-uuid" }).catch((e) => e);
      expect(err).toBeInstanceOf(ValidationError);
      expect(Object.keys(err.fieldErrors)).toEqual(["id"]);
    }));

  it("auto: false restores the old behavior - id required, supplied by you", () =>
    run(async (db) => {
      const { client } = await setup(db);
      const err = await client.models.manual.create({}).catch((e) => e);
      expect(err).toBeInstanceOf(ValidationError);
      expect((await client.models.manual.create({ id: 3 })).id).toBe(3);
    }));

  it("a document saved after creation updates by its generated id", () =>
    run(async (db) => {
      const { client } = await setup(db);
      const post = await client.models.post.create({ title: "before" });
      post.title = "after";
      await post.save();
      expect((await db("post").where({ id: post.id }).first()).title).toBe("after");
    }));

  it("create-DTOs no longer list id as something to supply", () =>
    run(async () => {
      const registry = new ModelRegistry();
      registry.define(MODELS[0]);
      const { create, read } = generateDTOSchemas(registry.getModel("post"));
      expect(create.properties).not.toHaveProperty("id");
      expect(read.required).toContain("id");
    }));
});

describe.each(eachIsolatedDialect())("automatic ids: migrations - $name", ({ run }) => {
  it("a migration-generated table keeps auto-increment, including after down and up again", () =>
    run(async (db) => {
      const dir = await mkdtemp(join(tmpdir(), "orm-autoid-"));
      try {
        const registry = new ModelRegistry();
        registry.define({ name: "post", fields: { id: { type: "integer", required: true }, title: { type: "char" } } });
        await generateMigrationFile(db, registry, { dir });
        await migrateUp(db, { dir });
        expect(await db("post").insert({ title: "a" }).returning("id")).toEqual([{ id: 1 }]);
        await migrateDown(db, { dir });
        await migrateUp(db, { dir });
        expect(await db("post").insert({ title: "b" }).returning("id")).toEqual([{ id: 1 }]);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }));
});

describe.each(eachIsolatedDialect())("automatic ids: the Global API - $name", ({ run }) => {
  it("createModel() models get them too, and `id` needn't be passed", () =>
    run(async (db) => {
      __resetGlobalStateForTests();
      connect(db);
      const Post = createModel("post", { fields: { id: { type: "integer", required: true }, title: { type: "char" } } });
      const Token = createModel("token", { fields: { id: { type: "uuid", required: true } } });
      await syncModels();
      const post = await Post.create({ title: "hello" });
      expect(post.id).toBe(1);
      expect((await Post.createMany([{ title: "a" }, { title: "b" }])).map((p) => p.id)).toEqual([2, 3]);
      expect((await Token.create({})).id).toMatch(/^[0-9a-f-]{36}$/);
    }));
});
