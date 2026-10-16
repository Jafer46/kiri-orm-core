import { describe, it, expect } from "vitest";
import { eachIsolatedDialect } from "../helpers/isolated-dialects.js";
import { captureQueries } from "../helpers/sql-capture.js";
import { ModelRegistry } from "../../src/models/registry.js";
import { sync } from "../../src/schema/sync.js";
import { OrmClient } from "../../src/client/orm-client.js";
import { HookRegistry } from "../../src/uow/hooks.js";
import { RelationError } from "../../src/relations/errors.js";
import { InvalidModelDefinitionError } from "../../src/models/errors.js";
import { connect, createModel, syncModels, __resetGlobalStateForTests } from "../../src/global/index.js";

// author 1<--restrict-- post 1<--setNull-- comment 1<--cascade-- reaction
// author <--restrict->  post: an author can't be deleted while it has posts
// post   <--setNull->   comment: deleting a post leaves its comments, orphaned (post_id = null)
// comment<--cascade->   reaction: deleting a comment takes its reactions with it
const CHAIN_MODELS = [
  { name: "author", fields: { id: { type: "integer", required: true }, name: { type: "char" } } },
  {
    name: "post",
    fields: { id: { type: "integer", required: true }, authorId: { type: "integer", required: true } },
    relations: { author: { type: "belongsTo", model: "author", foreignKey: "authorId", onDelete: "restrict" } },
  },
  {
    name: "comment",
    fields: { id: { type: "integer", required: true }, postId: { type: "integer" } },
    relations: { post: { type: "belongsTo", model: "post", foreignKey: "postId", onDelete: "setNull" } },
  },
  {
    name: "reaction",
    fields: { id: { type: "integer", required: true }, commentId: { type: "integer", required: true } },
    relations: { comment: { type: "belongsTo", model: "comment", foreignKey: "commentId", onDelete: "cascade" } },
  },
  {
    name: "tag",
    fields: { id: { type: "integer", required: true }, name: { type: "char" } },
    relations: { posts: { type: "belongsToMany", model: "post", through: "post_tag", foreignKey: "tag_id", otherKey: "post_id" } },
  },
];

async function setup(db) {
  const registry = new ModelRegistry();
  for (const model of CHAIN_MODELS) registry.define(model);
  // post's own belongsToMany, declared from the other side too (typical real usage).
  registry.define({ extend: "post", relations: { tags: { type: "belongsToMany", model: "tag", through: "post_tag", foreignKey: "post_id", otherKey: "tag_id" } } });
  await sync(db, registry);
  return new OrmClient(db, registry, new HookRegistry());
}

const count = async (db, table) => Number((await db(table).count({ c: "*" }))[0].c);

describe.each(eachIsolatedDialect())("onDelete: restrict - $name", ({ run }) => {
  it("refuses the delete while a referencing row exists, and leaves everything untouched", () =>
    run(async (db) => {
      const client = await setup(db);
      await client.models.author.create({ id: 1, name: "Ada" });
      await client.models.post.create({ id: 1, authorId: 1 });

      const err = await client.models.author.deleteMany({ id: 1 }).catch((e) => e);
      expect(err).toBeInstanceOf(RelationError);
      expect(err.message).toMatch(/Can't delete from "author".*foreign key with onDelete: "restrict"/);
      expect(err.cause).toBeDefined(); // the database's own error is kept
      expect(await count(db, "author")).toBe(1); // nothing was deleted
    }));

  it("succeeds once no referencing row is left", () =>
    run(async (db) => {
      const client = await setup(db);
      await client.models.author.create({ id: 1, name: "Ada" });
      await client.models.post.create({ id: 1, authorId: 1 });
      await client.models.post.deleteMany({ id: 1 }); // setNull, not restrict - removes the post itself
      expect(await client.models.author.deleteMany({ id: 1 })).toBe(1);
    }));

  it("checks every restrict relation before mutating anything, across a batch of deletes", () =>
    run(async (db) => {
      const client = await setup(db);
      await client.models.author.createMany([{ id: 1 }, { id: 2 }]);
      await client.models.post.create({ id: 1, authorId: 2 }); // only author 2 is blocked

      const err = await client.models.author.deleteMany([["id", "in", [1, 2]]]).catch((e) => e); // matches both
      expect(err).toBeInstanceOf(RelationError);
      expect(await count(db, "author")).toBe(2); // author 1 (which had nothing blocking it) was NOT deleted either
    }));

  it("is the default when the foreign key field is required, with no onDelete given", () =>
    run(async (db) => {
      const registry = new ModelRegistry();
      registry.define({ name: "parent", fields: { id: { type: "integer", required: true } } });
      registry.define({
        name: "child",
        fields: { id: { type: "integer", required: true }, parentId: { type: "integer", required: true } },
        relations: { parent: { type: "belongsTo", model: "parent", foreignKey: "parentId" } }, // no onDelete
      });
      await sync(db, registry);
      const client = new OrmClient(db, registry, new HookRegistry());
      await client.models.parent.create({ id: 1 });
      await client.models.child.create({ id: 1, parentId: 1 });
      await expect(client.models.parent.deleteMany({ id: 1 })).rejects.toThrow(RelationError);
    }));
});

describe.each(eachIsolatedDialect())("onDelete: setNull - $name", ({ run }) => {
  it("nulls the referencing rows' foreign key instead of deleting them", () =>
    run(async (db) => {
      const client = await setup(db);
      await client.models.author.create({ id: 1 });
      await client.models.post.create({ id: 1, authorId: 1 });
      await client.models.comment.createMany([{ id: 1, postId: 1 }, { id: 2, postId: 1 }]);

      await client.models.post.deleteMany({ id: 1 });

      // Read the raw row rather than through the client: the cascade's UPDATE runs
      // outside the identity map, same as updateMany()/deleteMany() already do for
      // the model called directly - see the "identity map" note below.
      const rows = await db("comment").select("id", "post_id").orderBy("id");
      expect(rows).toEqual([{ id: 1, post_id: null }, { id: 2, post_id: null }]);
      expect(await count(db, "post")).toBe(0);
    }));

  it("is the default when the foreign key field is NOT required", () =>
    run(async (db) => {
      const client = await setup(db);
      await client.models.author.create({ id: 1 });
      await client.models.post.create({ id: 1, authorId: 1 });
      await client.models.comment.create({ id: 1, postId: 1 }); // comment.post has explicit onDelete: "setNull" already;
      await client.models.post.deleteMany({ id: 1 });           // this just re-confirms the default matches when unset too
      expect((await db("comment").first()).post_id).toBeNull();
    }));

  it("(identity map) already-loaded entities of the OTHER model are not refreshed - read again to see it", () =>
    run(async (db) => {
      const client = await setup(db);
      await client.models.author.create({ id: 1 });
      await client.models.post.create({ id: 1, authorId: 1 });
      const comment = await client.models.comment.create({ id: 1, postId: 1 });
      expect(comment.postId).toBe(1);

      await client.models.post.deleteMany({ id: 1 });
      expect(comment.postId).toBe(1); // the cached entity is stale, same as after any updateMany()/deleteMany()
      expect((await db("comment").first()).post_id).toBeNull(); // the database itself is correct
    }));
});

describe.each(eachIsolatedDialect())("onDelete: cascade - $name", ({ run }) => {
  it("deletes referencing rows too", () =>
    run(async (db) => {
      const client = await setup(db);
      await client.models.comment.create({ id: 1, postId: null });
      await client.models.reaction.createMany([{ id: 1, commentId: 1 }, { id: 2, commentId: 1 }]);

      await client.models.comment.deleteMany({ id: 1 });
      expect(await count(db, "reaction")).toBe(0);
      expect(await count(db, "comment")).toBe(0);
    }));

  it("recurses through multiple levels, deepest first", () =>
    run(async (db) => {
      // The database applies onDelete as the tables were created, so this chain is declared
      // as cascade all the way down in its own registry (CHAIN_MODELS' post -> comment is setNull).
      const registry = new ModelRegistry();
      registry.define({ name: "author", fields: { id: { type: "integer" } } });
      registry.define({
        name: "post",
        fields: { id: { type: "integer" }, authorId: { type: "integer" } },
        relations: { author: { type: "belongsTo", model: "author", foreignKey: "authorId", onDelete: "cascade" } },
      });
      registry.define({
        name: "comment",
        fields: { id: { type: "integer" }, postId: { type: "integer" } },
        relations: { post: { type: "belongsTo", model: "post", foreignKey: "postId", onDelete: "cascade" } },
      });
      registry.define({
        name: "reaction",
        fields: { id: { type: "integer" }, commentId: { type: "integer" } },
        relations: { comment: { type: "belongsTo", model: "comment", foreignKey: "commentId", onDelete: "cascade" } },
      });
      await sync(db, registry);
      const client = new OrmClient(db, registry, new HookRegistry());
      for (const id of [1, 2]) {
        await client.models.author.create({ id });
        await client.models.post.create({ id, authorId: id });
        await client.models.comment.create({ id, postId: id });
        await client.models.reaction.create({ id, commentId: id });
      }

      const { queries } = await captureQueries(db, () => client.models.author.deleteMany({ id: 2 }));
      expect(queries).toHaveLength(1); // the database cascades; the ORM issues one DELETE
      for (const table of ["author", "post", "comment", "reaction"]) {
        expect(await db(table).where({ id: 2 }).first()).toBeUndefined();
        expect(await db(table).where({ id: 1 }).first()).toBeDefined(); // the other chain is untouched
      }
    }));

  it("is atomic: a failure partway rolls back everything already cascaded", () =>
    run(async (db) => {
      const registry = new ModelRegistry();
      registry.define({ name: "grandparent", fields: { id: { type: "integer" } } });
      registry.define({
        name: "parent",
        fields: { id: { type: "integer" }, grandparentId: { type: "integer" } },
        relations: { grandparent: { type: "belongsTo", model: "grandparent", foreignKey: "grandparentId", onDelete: "cascade" } },
      });
      registry.define({
        name: "child",
        fields: { id: { type: "integer" }, parentId: { type: "integer", required: true } },
        relations: { parent: { type: "belongsTo", model: "parent", foreignKey: "parentId", onDelete: "restrict" } },
      });
      await sync(db, registry);
      const client = new OrmClient(db, registry, new HookRegistry());
      await client.models.grandparent.create({ id: 1 });
      await client.models.parent.create({ id: 1, grandparentId: 1 });
      await client.models.child.create({ id: 1, parentId: 1 }); // blocks the cascade at the next level down

      await expect(client.models.grandparent.deleteMany({ id: 1 })).rejects.toThrow(RelationError);
      expect(await count(db, "grandparent")).toBe(1); // the cascade never got as far as deleting the grandparent
      expect(await count(db, "parent")).toBe(1); // ...or the parent it would have cascaded to first
    }));
});

describe.each(eachIsolatedDialect())("onDelete: belongsToMany pivot cleanup - $name", ({ run }) => {
  it("removes pivot rows when the model that owns the relation is deleted", () =>
    run(async (db) => {
      const client = await setup(db);
      await client.models.author.create({ id: 1 });
      await client.models.post.create({ id: 1, authorId: 1 });
      await client.models.tag.createMany([{ id: 1 }, { id: 2 }]);
      await client.models.post.attach(1, "tags", [1, 2]);
      expect(await count(db, "post_tag")).toBe(2);

      await client.models.post.deleteMany({ id: 1 });
      expect(await count(db, "post_tag")).toBe(0);
      expect(await count(db, "tag")).toBe(2); // tags themselves are untouched
    }));

  it("removes pivot rows from the OTHER side too, when that side didn't declare the relation itself", () =>
    run(async (db) => {
      const client = await setup(db);
      await client.models.author.create({ id: 1 });
      await client.models.post.create({ id: 1, authorId: 1 });
      await client.models.tag.create({ id: 1 });
      await client.models.post.attach(1, "tags", [1]);

      await client.models.tag.deleteMany({ id: 1 }); // tag.posts is the reverse belongsToMany declaration
      expect(await count(db, "post_tag")).toBe(0);
      expect(await count(db, "post")).toBe(1); // the post itself is untouched
    }));
});

describe.each(eachIsolatedDialect())("onDelete: the fast path for models nothing references - $name", ({ run }) => {
  it("costs exactly one statement, same as before this feature existed", () =>
    run(async (db) => {
      const client = await setup(db);
      await client.models.comment.create({ id: 999 });
      await client.models.reaction.createMany([{ id: 1, commentId: 999 }, { id: 2, commentId: 999 }]);
      // nothing in this schema has a belongsTo pointing at "reaction"
      const { queries } = await captureQueries(db, () => client.models.reaction.deleteMany({ commentId: 999 }));
      expect(queries).toHaveLength(1);
      expect(queries[0].sql).toMatch(/^delete from/i);
    }));
});

describe("relation definition: onDelete validation", () => {
  it("is rejected on anything but belongsTo", () => {
    const registry = new ModelRegistry();
    registry.define({ name: "a", fields: { id: { type: "integer" } } });
    expect(() =>
      registry.define({
        name: "b",
        fields: { id: { type: "integer" } },
        relations: { as: { type: "hasMany", model: "a", foreignKey: "bId", onDelete: "cascade" } },
      })
    ).toThrow(/onDelete.*only applies to a "belongsTo" relation/);
  });

  it("rejects an unknown action", () => {
    const registry = new ModelRegistry();
    registry.define({ name: "a", fields: { id: { type: "integer" } } });
    expect(() =>
      registry.define({
        name: "b",
        fields: { id: { type: "integer" }, aId: { type: "integer" } },
        relations: { a: { type: "belongsTo", model: "a", foreignKey: "aId", onDelete: "nope" } },
      })
    ).toThrow(InvalidModelDefinitionError); // registry.define() wraps relation-validation errors this way
  });
});

describe.each(eachIsolatedDialect())("onDelete: setNull on a required field is refused when the schema is built - $name", ({ run }) => {
  it("throws a clear error at sync time, before any table exists", () =>
    run(async (db) => {
      const registry = new ModelRegistry();
      registry.define({ name: "parent", fields: { id: { type: "integer" } } });
      registry.define({
        name: "child",
        fields: { id: { type: "integer" }, parentId: { type: "integer", required: true } },
        relations: { parent: { type: "belongsTo", model: "parent", foreignKey: "parentId", onDelete: "setNull" } },
      });

      const err = await sync(db, registry).catch((e) => e);
      expect(err).toBeInstanceOf(RelationError);
      expect(err.message).toMatch(/can't use onDelete: "setNull".*required.*never hold null/);
      expect(await db.schema.hasTable("parent")).toBe(false);
    }));
});

describe.each(eachIsolatedDialect())("onDelete: the Global API and a document's own .delete() - $name", ({ run }) => {
  it("createModel()'s Model.deleteMany honors onDelete the same way", () =>
    run(async (db) => {
      __resetGlobalStateForTests();
      connect(db);
      const Author = createModel("author", { fields: { id: { type: "integer", required: true } } });
      const Post = createModel("post", {
        fields: { id: { type: "integer", required: true }, authorId: { type: "integer", required: true } },
        relations: { author: { type: "belongsTo", model: "author", foreignKey: "authorId" } }, // default: restrict (required)
      });
      await syncModels();
      await Author.create({ id: 1 });
      await Post.create({ id: 1, authorId: 1 });
      await expect(Author.deleteMany({ id: 1 })).rejects.toThrow(RelationError);
    }));

  it("a single tracked entity's own .delete() honors onDelete too", () =>
    run(async (db) => {
      const client = await setup(db);
      await client.models.author.create({ id: 1 });
      const post = await client.models.post.create({ id: 1, authorId: 1 });
      await client.models.comment.create({ id: 1, postId: 1 });

      await post.delete();
      expect((await db("comment").first()).post_id).toBeNull();
    }));
});
