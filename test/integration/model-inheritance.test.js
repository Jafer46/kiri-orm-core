import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eachIsolatedDialect } from "../helpers/isolated-dialects.js";
import { ModelRegistry } from "../../src/models/registry.js";
import { sync } from "../../src/schema/sync.js";
import { OrmClient } from "../../src/client/orm-client.js";
import { createClient } from "../../src/client/create-client.js";
import { defineModule } from "../../src/client/module.js";
import { HookRegistry } from "../../src/uow/hooks.js";
import { RepositoryFactory } from "../../src/crud/repository-factory.js";
import { ValidationError } from "../../src/crud/errors.js";
import { diffSchema } from "../../src/migrations/diff.js";
import { generateMigrationFile, migrateUp } from "../../src/migrations/runner.js";
import { generateDTOSchemasForRegistry } from "../../src/dto/schema-generator.js";
import { connect, createModel, extendModel, defineMixin, syncModels, __resetGlobalStateForTests } from "../../src/global/index.js";

const columnsOf = async (db, table) => Object.keys(await db(table).columnInfo()).sort();

// Three independent "packages" contributing to one model.
const blogPackage = defineModule({
  name: "blog",
  models: [
    { name: "post", fields: { id: { type: "integer", required: true }, title: { type: "char", required: true, maxLength: 60 } } },
    { name: "comment", fields: { id: { type: "integer", required: true }, postId: { type: "integer", required: true }, body: { type: "char" } } },
  ],
});
const seoPackage = defineModule({
  name: "seo",
  models: [{ extend: "post", fields: { seoTitle: { type: "char", maxLength: 70 }, slug: { type: "char", required: true, unique: true } } }],
});
const engagementPackage = defineModule({
  name: "engagement",
  models: [
    {
      extend: "post",
      fields: { likes: { type: "integer", default: 0 } },
      relations: { comments: { type: "hasMany", model: "comment", foreignKey: "postId" } },
    },
  ],
});

function registryFrom(modules) {
  const registry = new ModelRegistry();
  for (const mod of modules) for (const model of mod.models) registry.define(model, { origin: mod.name });
  registry.assertResolved();
  return registry;
}

describe.each(eachIsolatedDialect())("extending another package's model - $name", ({ run }) => {
  it("extension fields become real columns of the base model's own table, whatever the load order", () =>
    run(async (db) => {
      // seo and engagement are listed BEFORE the package that defines `post`.
      const registry = registryFrom([seoPackage, engagementPackage, blogPackage]);
      const result = await sync(db, registry);

      expect(result.tablesCreated.sort()).toEqual(["comment", "post"]); // no table for the extension itself
      expect(await columnsOf(db, "post")).toEqual(["id", "likes", "seo_title", "slug", "title"]);
      expect(registry.getModel("post").origins).toMatchObject({ title: 'module "blog"', slug: 'module "seo"', likes: 'module "engagement"', comments: 'module "engagement"' });
    }));

  it("validates and stores extension fields, and eager-loads an extension's relation", () =>
    run(async (db) => {
      const registry = registryFrom([seoPackage, blogPackage, engagementPackage]);
      await sync(db, registry);
      const client = new OrmClient(db, registry, new HookRegistry());

      const post = await client.models.post.create({ id: 1, title: "Hello", slug: "hello", seoTitle: "Hello - a blog" });
      expect(post).toMatchObject({ slug: "hello", seoTitle: "Hello - a blog", likes: 0 }); // the extension's default applied

      const missing = await client.models.post.create({ id: 2, title: "No slug" }).catch((e) => e);
      expect(missing).toBeInstanceOf(ValidationError);
      expect(Object.keys(missing.fieldErrors)).toEqual(["slug"]); // required by the seo package, enforced on post

      await expect(client.models.post.create({ id: 3, title: "Dup", slug: "hello" })).rejects.toThrow(); // and unique

      await client.models.comment.create({ id: 1, postId: 1, body: "first" });
      const loaded = await client.models.post.findOne({ id: 1 }, { with: ["comments"] });
      expect(loaded.comments.map((c) => c.body)).toEqual(["first"]);
    }));

  it("a repository handed out earlier sees an extension registered afterwards", () =>
    run(async (db) => {
      const registry = registryFrom([blogPackage]);
      await sync(db, registry);
      const repos = new RepositoryFactory(db, registry);
      const before = repos.for("post");
      expect(Object.keys(before.model.fields)).toEqual(["id", "title"]);

      registry.define({ extend: "post", fields: { extra: { type: "char" } } });
      const after = repos.for("post");
      expect(after).not.toBe(before);
      expect(Object.keys(after.model.fields)).toEqual(["id", "title", "extra"]);
      expect(repos.for("post")).toBe(after); // and is cached again
    }));

  it("an extension added later shows up in the schema diff and flows through a migration, keeping data", () =>
    run(async (db) => {
      const dir = await mkdtemp(join(tmpdir(), "orm-inherit-"));
      try {
        const v1 = registryFrom([blogPackage]);
        await generateMigrationFile(db, v1, { dir });
        await migrateUp(db, { dir });
        await db("post").insert({ id: 1, title: "kept" });

        const v2 = registryFrom([blogPackage, engagementPackage]); // a new package now extends post
        const plan = await diffSchema(db, v2);
        expect(plan.fieldChanges.post.addFields).toEqual(["likes"]);

        const gen = await generateMigrationFile(db, v2, { dir });
        expect(gen.summary).toEqual(['[safe]        post: add field "likes"']);
        await migrateUp(db, { dir });
        expect(await columnsOf(db, "post")).toEqual(["id", "likes", "title"]);
        expect((await db("post").first()).title).toBe("kept");
        expect((await generateMigrationFile(db, v2, { dir })).file).toBeNull(); // and nothing further to migrate
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }));

  it("an extension can supply a computed, searchable field for a model it doesn't own", () =>
    run(async (db) => {
      const identity = defineModule({ name: "identity", models: [{ name: "person", fields: { id: { type: "integer", required: true }, first: { type: "char" }, last: { type: "char" } } }] });
      const display = defineModule({
        name: "display",
        models: [
          {
            extend: "person",
            fields: {
              fullName: {
                type: "char",
                depends: ["first", "last"],
                compute: (r) => `${r.first} ${r.last}`,
                search: (op, value) => (op === "=" ? [["first", "=", value.split(" ")[0]], ["last", "=", value.split(" ")[1]]] : ["|", ["first", op, value], ["last", op, value]]),
              },
            },
          },
        ],
      });
      const registry = registryFrom([display, identity]);
      await sync(db, registry);
      expect(await columnsOf(db, "person")).toEqual(["first", "id", "last"]); // still no column for it

      const client = new OrmClient(db, registry, new HookRegistry());
      await client.models.person.createMany([{ id: 1, first: "Ada", last: "Lovelace" }, { id: 2, first: "Alan", last: "Turing" }]);
      expect((await client.models.person.find({ fullName: "Alan Turing" })).map((p) => p.id)).toEqual([2]);
      expect((await client.models.person.findOne({ id: 1 })).fullName).toBe("Ada Lovelace");
    }));

  it("the DTOs and JSON schemas describe the merged model", () =>
    run(async () => {
      const schemas = generateDTOSchemasForRegistry(registryFrom([seoPackage, blogPackage, engagementPackage]));
      expect(Object.keys(schemas.post.create.properties)).toEqual(["title", "seoTitle", "slug", "likes"]);
      expect(schemas.post.create.required).toEqual(["title", "slug"]);
      expect(schemas.post.create.properties.slug).toEqual({ type: "string" });
    }));
});

describe.each(eachIsolatedDialect())("mixins - $name", ({ run }) => {
  const timestamped = {
    name: "timestamped",
    abstract: true,
    fields: { createdAt: { type: "datetime", default: () => new Date("2026-01-01T00:00:00Z") }, updatedAt: { type: "datetime" } },
  };

  it("give each model that uses them its own copy of the columns, and no table of their own", () =>
    run(async (db) => {
      const registry = new ModelRegistry();
      registry.define({ name: "invoice", mixins: ["timestamped"], fields: { id: { type: "integer", required: true }, total: { type: "float" } } });
      registry.define({ name: "customer", mixins: ["timestamped"], fields: { id: { type: "integer", required: true }, name: { type: "char" } } });
      registry.define(timestamped); // defined last: order doesn't matter

      const result = await sync(db, registry);
      expect(result.tablesCreated.sort()).toEqual(["customer", "invoice"]);
      expect(await db.schema.hasTable("timestamped")).toBe(false);
      expect(await columnsOf(db, "invoice")).toEqual(["created_at", "id", "total", "updated_at"]);
      expect(await columnsOf(db, "customer")).toEqual(["created_at", "id", "name", "updated_at"]);

      const client = new OrmClient(db, registry, new HookRegistry());
      const invoice = await client.models.invoice.create({ id: 1, total: 9.5 });
      expect(invoice.createdAt).toEqual(new Date("2026-01-01T00:00:00Z")); // the mixin's default applies
      expect(() => client.models.timestamped).toThrow(); // and there is no model handle for it
    }));

  it("a change to a mixin reaches every model using it, and becomes a migration for each table", () =>
    run(async (db) => {
      const dir = await mkdtemp(join(tmpdir(), "orm-mixin-"));
      try {
        const build = (extra) => {
          const registry = new ModelRegistry();
          registry.define(timestamped);
          registry.define({ name: "invoice", mixins: ["timestamped"], fields: { id: { type: "integer" } } });
          registry.define({ name: "customer", mixins: ["timestamped"], fields: { id: { type: "integer" } } });
          if (extra) registry.define({ extend: "timestamped", fields: { deletedAt: { type: "datetime" } } }, { origin: "softdelete" });
          return registry;
        };
        await generateMigrationFile(db, build(false), { dir });
        await migrateUp(db, { dir });

        const gen = await generateMigrationFile(db, build(true), { dir });
        expect(gen.summary.sort()).toEqual(['[safe]        customer: add field "deletedAt"', '[safe]        invoice: add field "deletedAt"']);
        await migrateUp(db, { dir });
        expect(await columnsOf(db, "invoice")).toContain("deleted_at");
        expect(await columnsOf(db, "customer")).toContain("deleted_at");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }));
});

describe.each(eachIsolatedDialect())("the global API: extendModel / defineMixin - $name", ({ run }) => {
  beforeEach(() => __resetGlobalStateForTests());

  it("extendModel before createModel waits, then applies; the Model sees the extension", () =>
    run(async (db) => {
      connect(db);
      extendModel("post", { fields: { seoTitle: { type: "char" } }, origin: "seo" });
      const Post = createModel("post", { fields: { id: { type: "integer", required: true }, title: { type: "char" } }, origin: "blog" });
      await syncModels();

      const post = await Post.create({ id: 1, title: "t", seoTitle: "seo" });
      expect(post.seoTitle).toBe("seo");
      expect(Object.keys(Post.schema.fields)).toEqual(["id", "title", "seoTitle"]);
    }));

  it("a Model created BEFORE another package extends it still sees the extension (no stale descriptor)", () =>
    run(async (db) => {
      connect(db);
      const Post = createModel("post", { fields: { id: { type: "integer", required: true }, title: { type: "char" } } });
      expect(Object.keys(Post.schema.fields)).toEqual(["id", "title"]);

      extendModel("post", { fields: { seoTitle: { type: "char" } } }); // some other package, later
      await syncModels();

      expect(Object.keys(Post.schema.fields)).toEqual(["id", "title", "seoTitle"]);
      const post = await Post.create({ id: 1, title: "t", seoTitle: "late" });
      await Post.createMany([{ id: 2, title: "u", seoTitle: "x" }]);
      post.seoTitle = "edited";
      await post.save(); // dirty tracking sees the extension field too
      expect((await db("post").where({ id: 1 }).first()).seo_title).toBe("edited");
      expect((await Post.find({ seoTitle: "x" })).map((p) => p.id)).toEqual([2]);
    }));

  it("extendModel returns a usable Model, even called before the base model exists", () =>
    run(async (db) => {
      connect(db);
      const OrderInvoice = extendModel("invoice", {
        fields: { orderId: { type: "integer", required: true, unique: true } },
        relations: { order: { type: "belongsTo", model: "order", foreignKey: "orderId" } },
      });
      expect(OrderInvoice).toBeTruthy();
      expect(OrderInvoice.name).toBe("invoice");
      expect(typeof OrderInvoice.create).toBe("function");

      const Order = createModel("order", { fields: { id: { type: "integer", required: true } } });
      createModel("invoice", { fields: { id: { type: "integer", required: true }, amountCents: { type: "integer", required: true } } });
      await syncModels();

      const order = await Order.create({ id: 7 });
      const invoice = await OrderInvoice.create({ id: 1, orderId: order.id, amountCents: 4200 });
      expect(invoice).toMatchObject({ id: 1, orderId: 7, amountCents: 4200 });

      const loaded = await OrderInvoice.findOne({ id: 1 }, { with: ["order"] });
      expect(loaded.order.id).toBe(7);
    }));

  it("extendModel and createModel for the same name always return the identical object, in either order", () =>
    run(async (db) => {
      connect(db);
      const extendFirst = extendModel("invoice", { fields: { orderId: { type: "integer" } } });
      const createAfter = createModel("invoice", { fields: { id: { type: "integer", required: true } } });
      expect(extendFirst).toBe(createAfter);

      const createFirst = createModel("credit_note", { fields: { id: { type: "integer", required: true } } });
      const extendAfter = extendModel("credit_note", { fields: { reason: { type: "char" } } });
      expect(createFirst).toBe(extendAfter);

      // and a second createModel call for the same name is rejected, as before - it is not a way to "get" the handle
      expect(() => createModel("invoice", { fields: { id: { type: "integer" } } })).toThrow(/already registered/);
    }));

  it("multiple extendModel calls for a still-undefined model all return the one eventual Model", () =>
    run(async (db) => {
      connect(db);
      const a = extendModel("invoice", { fields: { a: { type: "char" } }, origin: "pkg-a" });
      const b = extendModel("invoice", { fields: { b: { type: "char" } }, origin: "pkg-b" });
      expect(a).toBe(b);

      const Invoice = createModel("invoice", { fields: { id: { type: "integer", required: true } } });
      expect(Invoice).toBe(a);
      await syncModels();
      expect(Object.keys(Invoice.schema.fields)).toEqual(["id", "a", "b"]);
    }));

  it("extendModel can bring hooks for the model it extends", () =>
    run(async (db) => {
      connect(db);
      const Post = createModel("post", { fields: { id: { type: "integer", required: true }, slug: { type: "char" }, title: { type: "char" } } });
      extendModel("post", { hooks: { beforeCreate: (data) => (data.slug ??= String(data.title).toLowerCase()) } });
      await syncModels();
      expect((await Post.create({ id: 1, title: "Hello" })).slug).toBe("hello");
    }));

  it("extendModel rejects an unknown hook before registering anything", () => {
    const Post = createModel("post", { fields: { id: { type: "integer" } } });
    expect(() => extendModel("post", { fields: { x: { type: "char" } }, hooks: { beforeNothing() {} } })).toThrow(/unknown hook "beforeNothing"/);
    expect(Object.keys(Post.schema.fields)).toEqual(["id"]); // the extension's field was not applied either
  });

  it("defineMixin + createModel({ mixins }), in either order", () =>
    run(async (db) => {
      connect(db);
      const Invoice = createModel("invoice", { mixins: ["stamped"], fields: { id: { type: "integer", required: true } } }); // mixin not defined yet
      defineMixin("stamped", { fields: { createdBy: { type: "char" } } });
      await syncModels();

      expect(await columnsOf(db, "invoice")).toEqual(["created_by", "id"]);
      expect((await Invoice.create({ id: 1, createdBy: "ada" })).createdBy).toBe("ada");
    }));

  it("syncModels refuses to run while an extension is still waiting for its model", () =>
    run(async (db) => {
      connect(db);
      createModel("post", { fields: { id: { type: "integer" } } });
      extendModel("ghost", { fields: { x: { type: "char" } }, origin: "orphan" });
      await expect(syncModels()).rejects.toThrow(/Extension of "ghost" \(from module "orphan"\) needs "ghost"/);
    }));
});

describe("createClient with modules", () => {
  const sqlite = { dialect: "sqlite", filename: ":memory:" };

  it("resolves extensions across modules in any order and syncs the merged model", async () => {
    const client = createClient(sqlite, { modules: [seoPackage, engagementPackage, blogPackage] });
    try {
      await client.sync();
      const post = await client.models.post.create({ id: 1, title: "t", slug: "t" });
      expect(post.likes).toBe(0);
    } finally {
      await client.close();
    }
  });

  it("fails at construction, naming the module, when an extension's model never appears", () => {
    expect(() => createClient(sqlite, { modules: [seoPackage] })).toThrow(/Extension of "post" \(from module "seo"\) needs "post"/);
  });

  it("lets a module's own hooks run against the model another module defined", async () => {
    const audit = defineModule({
      name: "audit",
      models: [{ extend: "post", fields: { auditedAt: { type: "datetime" } } }],
      registerHooks: (hooks) => hooks.on("post", "beforeCreate", (data) => (data.auditedAt = new Date("2026-05-05T00:00:00Z"))),
    });
    const client = createClient(sqlite, { modules: [audit, blogPackage] });
    try {
      await client.sync();
      const post = await client.models.post.create({ id: 1, title: "t" });
      expect(post.auditedAt).toEqual(new Date("2026-05-05T00:00:00Z"));
    } finally {
      await client.close();
    }
  });
});
