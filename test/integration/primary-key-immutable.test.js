import { describe, it, expect, beforeEach } from "vitest";
import { eachIsolatedDialect } from "../helpers/isolated-dialects.js";
import { captureQueries } from "../helpers/sql-capture.js";
import { dataStatements, sequenceStatements } from "../helpers/blog-fixture.js";
import { ModelRegistry } from "../../src/models/registry.js";
import { sync } from "../../src/schema/sync.js";
import { OrmClient } from "../../src/client/orm-client.js";
import { HookRegistry } from "../../src/uow/hooks.js";
import { Repository } from "../../src/crud/repository.js";
import { ValidationError } from "../../src/crud/errors.js";
import { connect, createModel, syncModels, syncSequences, __resetGlobalStateForTests } from "../../src/global/index.js";

const POST = { name: "post", fields: { id: { type: "integer", required: true }, title: { type: "char" } } };
const TOKEN = { name: "token", fields: { id: { type: "uuid", required: true }, label: { type: "char" } } };

async function setupClient(db) {
  const registry = new ModelRegistry();
  registry.define(POST);
  registry.define(TOKEN);
  await sync(db, registry);
  const hooks = new HookRegistry();
  return { registry, hooks, client: new OrmClient(db, registry, hooks), repo: new Repository(db, registry.getModel("post"), undefined, registry) };
}

describe.each(eachIsolatedDialect())("primary key is immutable - $name", ({ name, run }) => {
  beforeEach(() => __resetGlobalStateForTests());

  it("Repository.update() refuses a payload naming the key, before sending any SQL", () =>
    run(async (db) => {
      const { repo } = await setupClient(db);
      await repo.create({ title: "a" });

      const { queries } = await captureQueries(db, async () => {
        await expect(repo.update({ title: "a" }, { id: 9 })).rejects.toBeInstanceOf(ValidationError);
        await expect(repo.update({ title: "a" }, { id: 9, title: "b" })).rejects.toThrow(/primary key/);
      });
      expect(queries).toHaveLength(0);
      expect((await repo.find()).map((r) => [r.id, r.title])).toEqual([[1, "a"]]);
    }));

  it("Repository.update() still updates every other field", () =>
    run(async (db) => {
      const { repo } = await setupClient(db);
      await repo.create({ title: "a" });
      expect(await repo.update({ id: 1 }, { title: "b" })).toBe(1);
      expect((await repo.findOne({ id: 1 })).title).toBe("b");
    }));

  it("client entity: changing the id and save() throws, reverts the entity, and runs no hook", () =>
    run(async (db) => {
      const { client, hooks } = await setupClient(db);
      const seen = [];
      hooks.on("post", "beforeUpdate", () => seen.push("beforeUpdate"));
      hooks.on("post", "beforeSave", () => seen.push("beforeSave"));

      const post = await client.models.post.create({ title: "a" });
      seen.length = 0; // create() fires beforeSave too; only what save() triggers matters here
      post.id = 3;
      await expect(post.save()).rejects.toBeInstanceOf(ValidationError);

      expect(post.id).toBe(1); // reverted to what is actually stored
      expect(seen).toEqual([]);
      expect(await db("post").select("id")).toEqual([{ id: 1 }]);
    }));

  it("client entity: editing other fields alongside is unaffected; only touching the key is rejected", () =>
    run(async (db) => {
      const { client } = await setupClient(db);
      const post = await client.models.post.create({ title: "a" });
      post.title = "b";
      await post.save();
      expect((await client.models.post.findOne({ id: 1 })).title).toBe("b");
    }));

  it("client updateMany() refuses the key too", () =>
    run(async (db) => {
      const { client } = await setupClient(db);
      await client.models.post.create({ title: "a" });
      await expect(client.models.post.updateMany({ title: "a" }, { id: 7 })).rejects.toBeInstanceOf(ValidationError);
    }));

  it("global API: document save() and updateMany() refuse the key", () =>
    run(async (db) => {
      connect(db);
      const Post = createModel("post", { fields: POST.fields });
      await syncModels();

      const doc = await Post.create({ title: "a" });
      doc.id = 3;
      await expect(doc.save()).rejects.toBeInstanceOf(ValidationError);
      expect(doc.id).toBe(1);
      await expect(Post.updateMany({ title: "a" }, { id: 3 })).rejects.toBeInstanceOf(ValidationError);
    }));

  // The bug this closes: on Postgres, moving a row's id to the sequence's next value made the
  // next auto-assigned id collide with it. Now the move is refused, so it can't happen.
  it("regression: the next auto id can no longer collide with a manually moved one", () =>
    run(async (db) => {
      const { client } = await setupClient(db);
      await client.models.post.create({ title: "a" });
      const b = await client.models.post.create({ title: "b" });
      b.id = 3; // exactly what the sequence hands out next
      await expect(b.save()).rejects.toBeInstanceOf(ValidationError);

      const c = await client.models.post.create({ title: "c" });
      expect(c.id).toBe(3);
    }));

  it("uuid keys are immutable as well", () =>
    run(async (db) => {
      const { client } = await setupClient(db);
      const token = await client.models.token.create({ label: "x" });
      token.id = "6a56dc83-83ee-4109-bbc4-b4301bf55f03";
      await expect(token.save()).rejects.toBeInstanceOf(ValidationError);
    }));
});

describe.each(eachIsolatedDialect())("syncSequences() - $name", ({ name, run }) => {
  beforeEach(() => __resetGlobalStateForTests());
  const postgres = name === "postgres";

  // Ids that arrive behind the ORM's back (seed script, restored dump, raw insert) leave a
  // Postgres sequence behind. This is the case advanceSequence() can't see.
  it.runIf(postgres)("without a repair, a raw insert leaves the sequence behind (the failure being fixed)", () =>
    run(async (db) => {
      const { client } = await setupClient(db);
      await db("post").insert([{ id: 1, title: "raw" }, { id: 2, title: "raw" }]);
      await expect(client.models.post.create({ title: "auto" })).rejects.toThrow(/duplicate key/);
    }));

  it("client.syncSequences() repairs it, and never reuses or collides", () =>
    run(async (db) => {
      const { client } = await setupClient(db);
      await db("post").insert([{ id: 1, title: "raw" }, { id: 2, title: "raw" }, { id: 40, title: "raw" }]);

      const report = await client.syncSequences();
      expect(report).toEqual([
        { model: "post", table: "post", synced: postgres },
        { model: "token", table: "token", synced: false }, // uuid: no sequence
      ]);

      const created = await client.models.post.create({ title: "auto" });
      expect(created.id).toBeGreaterThan(40);
    }));

  it("is idempotent, and never moves a sequence backwards (ids of deleted rows aren't reused)", () =>
    run(async (db) => {
      const { client } = await setupClient(db);
      const rows = await client.models.post.createMany([{ title: "a" }, { title: "b" }, { title: "c" }]);
      await client.models.post.deleteMany({ id: rows[2].id }); // the highest id is gone

      await client.syncSequences();
      await client.syncSequences();
      const next = await client.models.post.create({ title: "d" });
      expect(next.id).toBeGreaterThan(rows[2].id);
    }));

  it("works on an empty table", () =>
    run(async (db) => {
      const { client } = await setupClient(db);
      await client.syncSequences();
      expect((await client.models.post.create({ title: "first" })).id).toBeGreaterThanOrEqual(1);
    }));

  it("global syncSequences() does the same for the default registry, and accepts { trx }", () =>
    run(async (db) => {
      connect(db);
      const Post = createModel("post", { fields: POST.fields });
      await syncModels();
      await db("post").insert({ id: 10, title: "raw" });

      const report = await syncSequences();
      expect(report).toEqual([{ model: "post", table: "post", synced: postgres }]);
      expect((await Post.create({ title: "auto" })).id).toBeGreaterThan(10);

      await db("post").insert({ id: 200, title: "raw" });
      await db.transaction(async (trx) => {
        await syncSequences({ trx });
      });
      expect((await Post.create({ title: "auto" })).id).toBeGreaterThan(200);
    }));

  it.runIf(postgres)("client.syncSequences() inside a transaction uses that transaction", () =>
    run(async (db) => {
      const { client } = await setupClient(db);
      await db("post").insert({ id: 50, title: "raw" });
      await client.transaction(async (tx) => {
        await tx.syncSequences();
        expect((await tx.models.post.create({ title: "in-trx" })).id).toBeGreaterThan(50);
      });
    }));

  // advanceSequence() (explicit ids on create) costs at most one extra statement per table
  // written, however many rows - it must not turn a bulk insert back into N statements.
  it.runIf(postgres)("explicit ids cost one sequence statement per insert, not one per row", () =>
    run(async (db) => {
      const { repo } = await setupClient(db);
      const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, title: `p${i}` }));

      const small = await captureQueries(db, () => repo.createMany(rows(3)));
      await db("post").del();
      const large = await captureQueries(db, () => repo.createMany(rows(300)));

      expect(sequenceStatements(small.queries)).toHaveLength(1);
      expect(sequenceStatements(large.queries)).toHaveLength(1);
      expect(dataStatements(large.queries)).toHaveLength(dataStatements(small.queries).length);
    }));
});
