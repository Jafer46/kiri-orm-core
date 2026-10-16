import { describe, it, expect, beforeEach } from "vitest";
import { eachIsolatedDialect } from "../helpers/isolated-dialects.js";
import { BLOG_MODELS } from "../helpers/blog-fixture.js";
import { Command } from "../../src/relations/commands.js";
import { connect, createModel, syncModels, withIdentityMap, __resetGlobalStateForTests } from "../../src/global/index.js";

function defineGlobalModels() {
  const models = {};
  for (const { name, fields, relations } of BLOG_MODELS) models[name] = createModel(name, { fields, relations });
  return models;
}

async function setup(db) {
  connect(db);
  const models = defineGlobalModels();
  await syncModels();
  await models.post.createMany([
    { id: 1, title: "one" },
    { id: 2, title: "two" },
  ]);
  return models;
}

describe.each(eachIsolatedDialect())("global API: withIdentityMap - $name", ({ run }) => {
  beforeEach(() => __resetGlobalStateForTests());

  it("changes nothing outside a scope: two finds are two different documents", () =>
    run(async (db) => {
      const { post } = await setup(db);
      const a = await post.findOne({ id: 1 });
      const b = await post.findOne({ id: 1 });
      expect(a).not.toBe(b);
    }));

  it("inside a scope, find / findOne return one instance per row", () =>
    run(async (db) => {
      const { post } = await setup(db);
      await withIdentityMap(async () => {
        const a = await post.findOne({ id: 1 });
        const b = await post.findOne({ id: 1 });
        const [c] = await post.find({ id: 1 });
        expect(b).toBe(a);
        expect(c).toBe(a);
        expect(await post.findOne({ id: 2 })).not.toBe(a); // different row, different instance
      });
    }));

  it("create() and createMany() register their documents, including nested children", () =>
    run(async (db) => {
      const { post, comment } = await setup(db);
      await withIdentityMap(async () => {
        const created = await post.create({ id: 10, title: "new" });
        expect(await post.findOne({ id: 10 })).toBe(created);

        const [withChild] = await post.createMany([
          { id: 11, title: "p", comments: [Command.create({ id: 110, body: "hi" })] },
        ]);
        expect(await post.findOne({ id: 11 })).toBe(withChild);
        const child = await comment.findOne({ id: 110 });
        expect(child.body).toBe("hi");
        expect(await comment.findOne({ id: 110 })).toBe(child);
      });
    }));

  it("keeps unsaved in-memory edits when the row is loaded again, and shares them between references", () =>
    run(async (db) => {
      const { post } = await setup(db);
      await withIdentityMap(async () => {
        const first = await post.findOne({ id: 1 });
        first.title = "edited, unsaved";

        const second = await post.findOne({ id: 1 });
        expect(second.title).toBe("edited, unsaved"); // not clobbered by the DB's "one"
        await second.save(); // saved through the other reference
        expect((await db("post").where({ id: 1 }).first()).title).toBe("edited, unsaved");
        expect((await post.findOne({ id: 1 })).title).toBe("edited, unsaved");
      });
    }));

  it("refreshes eager-loaded relations on a reused document", () =>
    run(async (db) => {
      const { post } = await setup(db);
      await withIdentityMap(async () => {
        const plain = await post.findOne({ id: 1 });
        expect(plain.comments).toBeUndefined();

        await db("comment").insert({ id: 1, post_id: 1, body: "c", likes: 0 });
        const loaded = await post.findOne({ id: 1 }, { with: ["comments"] });
        expect(loaded).toBe(plain);
        expect(plain.comments.map((c) => c.body)).toEqual(["c"]);
      });
    }));

  it("delete() drops the document from the scope, so a re-created row is a fresh instance", () =>
    run(async (db) => {
      const { post } = await setup(db);
      await withIdentityMap(async () => {
        const doc = await post.findOne({ id: 1 });
        await doc.delete();
        expect(await post.findOne({ id: 1 })).toBeNull();

        const recreated = await post.create({ id: 1, title: "again" });
        expect(recreated).not.toBe(doc);
        expect(await post.findOne({ id: 1 })).toBe(recreated);
      });
    }));

  it("ends with the scope: the same row loaded afterwards is a different document", () =>
    run(async (db) => {
      const { post } = await setup(db);
      const inside = await withIdentityMap(() => post.findOne({ id: 1 }));
      expect(await post.findOne({ id: 1 })).not.toBe(inside);
    }));

  it("isolates concurrent scopes from each other", () =>
    run(async (db) => {
      const { post } = await setup(db);
      const load = () =>
        withIdentityMap(async () => {
          const a = await post.findOne({ id: 1 });
          await new Promise((resolve) => setTimeout(resolve, 5)); // let the other scope interleave
          const b = await post.findOne({ id: 1 });
          return { a, b };
        });

      const [x, y] = await Promise.all([load(), load()]);
      expect(x.b).toBe(x.a); // one instance within a scope...
      expect(y.b).toBe(y.a);
      expect(x.a).not.toBe(y.a); // ...but never shared across scopes
    }));

  it("gives a nested scope its own map, and returns the callback's result or error", () =>
    run(async (db) => {
      const { post } = await setup(db);
      await withIdentityMap(async () => {
        const outer = await post.findOne({ id: 1 });
        const inner = await withIdentityMap(() => post.findOne({ id: 1 }));
        expect(inner).not.toBe(outer);
        expect(await post.findOne({ id: 1 })).toBe(outer); // outer scope intact after the inner one
      });

      expect(await withIdentityMap(() => 42)).toBe(42);
      await expect(withIdentityMap(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    }));
});
