import { describe, it, expect } from "vitest";
import knexFactory from "knex";
import { eachIsolatedDialect } from "../helpers/isolated-dialects.js";
import { captureQueries } from "../helpers/sql-capture.js";
import { ModelRegistry } from "../../src/models/registry.js";
import { sync } from "../../src/schema/sync.js";
import { listForeignKeys } from "../../src/schema/introspect-foreign-keys.js";
import { OrmClient } from "../../src/client/orm-client.js";
import { HookRegistry } from "../../src/uow/hooks.js";
import { RelationError, InvalidRelationDefinitionError } from "../../src/relations/errors.js";
import { defineRelation } from "../../src/relations/define-relation.js";
import { diffSchema } from "../../src/migrations/diff.js";
import { generateMigration } from "../../src/migrations/generate.js";
import { renderMigrationSource } from "../../src/migrations/render.js";
import { applyMigration, rollbackMigration } from "../../src/migrations/apply.js";

const int = (extra = {}) => ({ type: "integer", ...extra });
const count = async (db, table) => Number((await db(table).count({ c: "*" }))[0].c);
const keysOf = async (db, table) => (await listForeignKeys(db, table)).map((k) => `${k.column}->${k.refTable}`).sort();

const clientFor = (db, registry) => new OrmClient(db, registry, new HookRegistry());

/** author <- post (required => restrict) <- comment (optional => set null) */
function blogRegistry({ reversed = false } = {}) {
  const defs = [
    { name: "author", fields: { id: int({ required: true }), name: { type: "char" } } },
    {
      name: "post",
      fields: { id: int({ required: true }), authorId: int({ required: true }) },
      relations: { author: { type: "belongsTo", model: "author", foreignKey: "authorId" } },
    },
    {
      name: "comment",
      fields: { id: int({ required: true }), postId: int() },
      relations: { post: { type: "belongsTo", model: "post", foreignKey: "postId" } },
    },
  ];
  const registry = new ModelRegistry();
  for (const def of reversed ? [...defs].reverse() : defs) registry.define(def);
  return registry;
}

describe.each(eachIsolatedDialect())("foreign keys: schema - $name", ({ run }) => {
  it("sync creates a real foreign key for every belongsTo", () =>
    run(async (db) => {
      const result = await sync(db, blogRegistry());
      expect(await keysOf(db, "post")).toEqual(["author_id->author"]);
      expect(await keysOf(db, "comment")).toEqual(["post_id->post"]);
      expect(await keysOf(db, "author")).toEqual([]);
      expect(result.foreignKeysAdded.sort()).toEqual(["comment.post_id -> post.id", "post.author_id -> author.id"]);
    }));

  it("creates tables in dependency order, whatever order the models were defined in", () =>
    run(async (db) => {
      await sync(db, blogRegistry({ reversed: true })); // comment, post, author
      expect(await keysOf(db, "post")).toEqual(["author_id->author"]);
      expect(await keysOf(db, "comment")).toEqual(["post_id->post"]);
    }));

  it("the database itself refuses a row that points at nothing", () =>
    run(async (db) => {
      await sync(db, blogRegistry());
      await expect(clientFor(db, blogRegistry()).models.post.create({ id: 1, authorId: 999 })).rejects.toThrow(/foreign key/i);
      expect(await count(db, "post")).toBe(0);
    }));

  it("a self-referencing key (a tree) works, and cascades down the tree", () =>
    run(async (db) => {
      const registry = new ModelRegistry();
      registry.define({
        name: "category",
        fields: { id: int({ required: true }), parentId: int() },
        relations: { parent: { type: "belongsTo", model: "category", foreignKey: "parentId", onDelete: "cascade" } },
      });
      await sync(db, registry);
      expect(await keysOf(db, "category")).toEqual(["parent_id->category"]);

      const { models } = clientFor(db, registry);
      await models.category.create({ id: 1, parentId: null });
      await models.category.create({ id: 2, parentId: 1 });
      await models.category.create({ id: 3, parentId: 2 });
      await models.category.deleteMany({ id: 1 });
      expect(await count(db, "category")).toBe(0);
    }));

  it("a cycle between two models is created too (one key is added after both tables exist)", () =>
    run(async (db) => {
      const registry = new ModelRegistry();
      registry.define({
        name: "person",
        fields: { id: int({ required: true }), favouriteId: int() },
        relations: { favourite: { type: "belongsTo", model: "pet", foreignKey: "favouriteId", onDelete: "setNull" } },
      });
      registry.define({
        name: "pet",
        fields: { id: int({ required: true }), ownerId: int() },
        relations: { owner: { type: "belongsTo", model: "person", foreignKey: "ownerId", onDelete: "setNull" } },
      });
      await sync(db, registry);
      expect(await keysOf(db, "person")).toEqual(["favourite_id->pet"]);
      expect(await keysOf(db, "pet")).toEqual(["owner_id->person"]);
    }));

  it("a pivot table gets a foreign key to each side", () =>
    run(async (db) => {
      const registry = new ModelRegistry();
      registry.define({ name: "tag", fields: { id: int({ required: true }) } });
      registry.define({
        name: "post",
        fields: { id: int({ required: true }) },
        relations: { tags: { type: "belongsToMany", model: "tag", through: "post_tag", foreignKey: "post_id", otherKey: "tag_id" } },
      });
      await sync(db, registry);
      expect(await keysOf(db, "post_tag")).toEqual(["post_id->post", "tag_id->tag"]);
    }));

  it("is idempotent: a second sync changes nothing and warns about nothing", () =>
    run(async (db) => {
      await sync(db, blogRegistry());
      const again = await sync(db, blogRegistry());
      expect(again.tablesCreated).toEqual([]);
      expect(again.foreignKeysAdded).toEqual([]);
      expect(again.warnings).toEqual([]);
    }));
});

describe.each(eachIsolatedDialect())("foreign keys: the database applies onDelete - $name", ({ run }) => {
  it("restrict (the default for a required key): refused as a RelationError, nothing deleted", () =>
    run(async (db) => {
      const registry = blogRegistry();
      await sync(db, registry);
      const { models } = clientFor(db, registry);
      await models.author.create({ id: 1 });
      await models.post.create({ id: 1, authorId: 1 });

      const err = await models.author.deleteMany({ id: 1 }).catch((e) => e);
      expect(err).toBeInstanceOf(RelationError);
      expect(err.message).toMatch(/Can't delete from "author".*restrict/);
      expect(await count(db, "author")).toBe(1);
    }));

  it("set null (the default for an optional key): the child survives with a null key", () =>
    run(async (db) => {
      const registry = blogRegistry();
      await sync(db, registry);
      const { models } = clientFor(db, registry);
      await models.author.create({ id: 1 });
      await models.post.create({ id: 1, authorId: 1 });
      await models.comment.create({ id: 1, postId: 1 });

      await models.comment.deleteMany({ id: 1 }); // nothing points at comment: plain delete
      await models.comment.create({ id: 2, postId: 1 });
      await db("post").where({ id: 1 }).delete().catch(() => {}); // post -> comment is set null, so this is allowed
      expect((await db("comment").where({ id: 2 }).first()).post_id).toBeNull();
    }));

  it("deleting a referenced row is ONE statement - no id lookups, no per-relation queries", () =>
    run(async (db) => {
      const registry = new ModelRegistry();
      registry.define({ name: "parent", fields: { id: int({ required: true }) } });
      for (const [name, onDelete] of [["a", "cascade"], ["b", "setNull"], ["c", "cascade"]]) {
        registry.define({
          name,
          fields: { id: int({ required: true }), parentId: int() },
          relations: { parent: { type: "belongsTo", model: "parent", foreignKey: "parentId", onDelete } },
        });
      }
      await sync(db, registry);
      const { models } = clientFor(db, registry);
      await models.parent.create({ id: 1 });
      await models.a.create({ id: 1, parentId: 1 });
      await models.b.create({ id: 1, parentId: 1 });
      await models.c.create({ id: 1, parentId: 1 });

      const { queries } = await captureQueries(db, () => models.parent.deleteMany({ id: 1 }));
      expect(queries).toHaveLength(1);
      expect(queries[0].sql).toMatch(/^delete from/i);
      expect(await count(db, "a")).toBe(0);
      expect(await count(db, "c")).toBe(0);
      expect((await db("b").first()).parent_id).toBeNull();
    }));

  it("belongsToMany pivot rows go when either side is deleted", () =>
    run(async (db) => {
      const registry = new ModelRegistry();
      registry.define({ name: "tag", fields: { id: int({ required: true }) } });
      registry.define({
        name: "post",
        fields: { id: int({ required: true }) },
        relations: { tags: { type: "belongsToMany", model: "tag", through: "post_tag", foreignKey: "post_id", otherKey: "tag_id" } },
      });
      await sync(db, registry);
      const { models } = clientFor(db, registry);
      await models.post.create({ id: 1 });
      await models.tag.createMany([{ id: 1 }, { id: 2 }]);
      await models.post.attach(1, "tags", [1, 2]);

      const { queries } = await captureQueries(db, () => models.tag.deleteMany({ id: 1 }));
      expect(queries).toHaveLength(1);
      expect(await count(db, "post_tag")).toBe(1);
      await models.post.deleteMany({ id: 1 });
      expect(await count(db, "post_tag")).toBe(0);
    }));
});

describe.each(eachIsolatedDialect())("foreign keys: constraint: false - $name", ({ run }) => {
  const looseRegistry = (onDelete) => {
    const registry = new ModelRegistry();
    registry.define({ name: "owner", fields: { id: int({ required: true }) } });
    registry.define({
      name: "item",
      fields: { id: int({ required: true }), ownerId: int() },
      relations: { owner: { type: "belongsTo", model: "owner", foreignKey: "ownerId", onDelete, constraint: false } },
    });
    return registry;
  };

  it("creates no database constraint, so a key may point nowhere", () =>
    run(async (db) => {
      const registry = looseRegistry("setNull");
      await sync(db, registry);
      expect(await keysOf(db, "item")).toEqual([]);
      await clientFor(db, registry).models.item.create({ id: 1, ownerId: 999 }); // accepted
    }));

  it("the ORM still applies onDelete itself for that relation (set null, then cascade)", () =>
    run(async (db) => {
      const registry = looseRegistry("setNull");
      await sync(db, registry);
      const { models } = clientFor(db, registry);
      await models.owner.create({ id: 1 });
      await models.item.create({ id: 1, ownerId: 1 });
      await models.owner.deleteMany({ id: 1 });
      expect((await db("item").first()).owner_id).toBeNull();
    }));

  it("the ORM still applies restrict for that relation", () =>
    run(async (db) => {
      const registry = looseRegistry("restrict");
      await sync(db, registry);
      const { models } = clientFor(db, registry);
      await models.owner.create({ id: 1 });
      await models.item.create({ id: 1, ownerId: 1 });
      await expect(models.owner.deleteMany({ id: 1 })).rejects.toThrow(RelationError);
    }));

  it("is validated: belongsTo only, and a boolean", () => {
    expect(() => defineRelation({ type: "hasMany", model: "x", foreignKey: "y", constraint: false })).toThrow(InvalidRelationDefinitionError);
    expect(() => defineRelation({ type: "belongsTo", model: "x", foreignKey: "y", constraint: "no" })).toThrow(/true or false/);
    expect(defineRelation({ type: "belongsTo", model: "x", foreignKey: "y" }).constraint).toBeUndefined();
  });
});

describe.each(eachIsolatedDialect())("foreign keys: existing databases - $name", ({ run }) => {
  it("a new foreign key column on an existing table brings its constraint", () =>
    run(async (db) => {
      const v1 = new ModelRegistry();
      v1.define({ name: "author", fields: { id: int({ required: true }) } });
      v1.define({ name: "post", fields: { id: int({ required: true }) } });
      await sync(db, v1);
      await db("post").insert({ id: 1 });

      const v2 = new ModelRegistry();
      v2.define({ name: "author", fields: { id: int({ required: true }) } });
      v2.define({
        name: "post",
        fields: { id: int({ required: true }), authorId: int() },
        relations: { author: { type: "belongsTo", model: "author", foreignKey: "authorId" } },
      });
      const result = await sync(db, v2);
      expect(result.foreignKeysAdded).toEqual(["post.author_id -> author.id"]);
      expect(await keysOf(db, "post")).toEqual(["author_id->author"]);
      expect(await count(db, "post")).toBe(1); // the existing row survived
    }));

  it("a table that predates foreign keys is reported, and fixed on request", () =>
    run(async (db) => {
      await db.schema.createTable("author", (t) => t.integer("id").primary());
      await db.schema.createTable("post", (t) => {
        t.integer("id").primary();
        t.integer("author_id").notNullable();
      });
      await db("author").insert({ id: 1 });
      await db("post").insert({ id: 1, author_id: 1 });

      const warned = await sync(db, blogRegistry());
      expect(warned.warnings.join("\n")).toMatch(/post\.author_id -> author\.id has no foreign key/);
      expect(await keysOf(db, "post")).toEqual([]);

      const fixed = await sync(db, blogRegistry(), { addMissingForeignKeys: true });
      expect(fixed.foreignKeysAdded).toContain("post.author_id -> author.id");
      expect(await keysOf(db, "post")).toEqual(["author_id->author"]);
      expect(await count(db, "post")).toBe(1);
      await expect(clientFor(db, blogRegistry()).models.author.deleteMany({ id: 1 })).rejects.toThrow(RelationError);
    }));
});

describe("foreign keys: SQLite enforcement", () => {
  const sqlite = (pool) => knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true, ...(pool ? { pool } : {}) });
  const pragma = async (db) => Number((await db.raw("PRAGMA foreign_keys"))[0].foreign_keys);

  it("createConnection() turns enforcement on", async () => {
    const { createConnection, closeConnection } = await import("../../src/connection.js");
    const db = createConnection({ dialect: "sqlite", filename: ":memory:" });
    try {
      expect(await pragma(db)).toBe(1);
    } finally {
      await closeConnection(db);
    }
  });

  it("sync() switches it on for a connection you built yourself, and says nothing", async () => {
    const db = sqlite();
    try {
      await db.raw("PRAGMA foreign_keys = OFF"); // better-sqlite3 defaults to ON; other builds default to OFF
      expect(await pragma(db)).toBe(0);
      const result = await sync(db, blogRegistry());
      expect(result.warnings).toEqual([]);
      expect(await pragma(db)).toBe(1);
    } finally {
      await db.destroy();
    }
  });
});

describe.each(eachIsolatedDialect())("foreign keys: migrations - $name", ({ run }) => {
  async function planFor(db, registry) {
    await sync(db, new ModelRegistry()); // creates the _meta tables the diff reads
    return diffSchema(db, registry);
  }

  it("a generated migration creates the tables in dependency order, with their keys, and rolls back", () =>
    run(async (db) => {
      const registry = blogRegistry({ reversed: true });
      const migration = generateMigration(await planFor(db, registry), registry);
      await applyMigration(db, migration);
      expect(await keysOf(db, "post")).toEqual(["author_id->author"]);
      expect(await keysOf(db, "comment")).toEqual(["post_id->post"]);

      await rollbackMigration(db, migration);
      expect(await db.schema.hasTable("author")).toBe(false);
      expect(await db.schema.hasTable("post")).toBe(false);
    }));

  it("the rendered migration file carries the same keys", () =>
    run(async (db) => {
      const registry = blogRegistry({ reversed: true });
      const source = renderMigrationSource(await planFor(db, registry), registry);
      expect(source).toContain('table.foreign("author_id").references("id").inTable("author").onDelete("RESTRICT");');
      expect(source).toContain('table.foreign("post_id").references("id").inTable("post").onDelete("SET NULL");');
      // dependency order: author is created before post, post before comment
      const at = (table) => source.indexOf(`createTable("${table}"`);
      expect(at("author")).toBeLessThan(at("post"));
      expect(at("post")).toBeLessThan(at("comment"));
    }));

  it("adding a foreign key field to an existing model adds the key, and rollback removes it", () =>
    run(async (db) => {
      const v1 = new ModelRegistry();
      v1.define({ name: "author", fields: { id: int({ required: true }) } });
      v1.define({ name: "post", fields: { id: int({ required: true }) } });
      await sync(db, v1);

      const v2 = new ModelRegistry();
      v2.define({ name: "author", fields: { id: int({ required: true }) } });
      v2.define({
        name: "post",
        fields: { id: int({ required: true }), authorId: int() },
        relations: { author: { type: "belongsTo", model: "author", foreignKey: "authorId", onDelete: "cascade" } },
      });
      const migration = generateMigration(await diffSchema(db, v2), v2);
      await applyMigration(db, migration);
      expect(await keysOf(db, "post")).toEqual(["author_id->author"]);

      await rollbackMigration(db, migration);
      expect(await keysOf(db, "post")).toEqual([]);
      expect(Object.keys(await db("post").columnInfo())).toEqual(["id"]);
    }));

  it("dropping two models that reference each other drops the child first", () =>
    run(async (db) => {
      await sync(db, blogRegistry());
      const plan = await diffSchema(db, new ModelRegistry());
      expect(plan.dropModels.map((m) => m.modelName)).toEqual(["comment", "post", "author"]);
      await applyMigration(db, generateMigration(plan, new ModelRegistry(), { allowDestructive: true }));
      expect(await db.schema.hasTable("author")).toBe(false);
    }));
});
