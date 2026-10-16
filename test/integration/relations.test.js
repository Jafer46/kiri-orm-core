import { describe, it, expect } from "vitest";
import { eachDialect, withConnection } from "../helpers/dialects.js";
import { countQueries } from "../helpers/query-counter.js";
import { ModelRegistry } from "../../src/models/registry.js";
import { sync } from "../../src/schema/sync.js";
import { RepositoryFactory } from "../../src/crud/repository-factory.js";
import { Repository } from "../../src/crud/repository.js";
import { RelationError } from "../../src/relations/errors.js";
import { getFieldsMeta } from "../../src/meta/query.js";

function buildInvoicingRegistry({ customerConstraint = true } = {}) {
  const registry = new ModelRegistry();

  registry.define({
    name: "customer",
    fields: {
      id: { type: "integer", required: true },
      name: { type: "char", required: true },
    },
  });

  registry.define({
    name: "invoice",
    fields: {
      id: { type: "integer", required: true },
      customerId: { type: "integer", required: true },
      total: { type: "float" },
    },
    relations: {
      customer: { type: "belongsTo", model: "customer", foreignKey: "customerId", constraint: customerConstraint },
      lines: { type: "hasMany", model: "invoiceLine", foreignKey: "invoiceId" },
      tags: {
        type: "belongsToMany",
        model: "tag",
        through: "invoice_tag",
        foreignKey: "invoice_id",
        otherKey: "tag_id",
      },
    },
  });

  registry.define({
    name: "invoiceLine",
    fields: {
      id: { type: "integer", required: true },
      invoiceId: { type: "integer", required: true },
      description: { type: "char" },
    },
    relations: {
      invoice: { type: "belongsTo", model: "invoice", foreignKey: "invoiceId" },
    },
  });

  registry.define({
    name: "tag",
    fields: {
      id: { type: "integer", required: true },
      name: { type: "char", required: true },
    },
  });

  return registry;
}

describe.each(eachDialect())("relations - %s", ({ name, connect }) => {
  it("belongsTo: eager-loads the related record with the correct shape", async () => {
    await withConnection(connect, async (db) => {
      const registry = buildInvoicingRegistry();
      await sync(db, registry);
      const repos = new RepositoryFactory(db, registry);

      await repos.for("customer").create({ id: 1, name: "Acme" });
      await repos.for("invoice").create({ id: 1, customerId: 1, total: 100 });

      const [invoice] = await repos.for("invoice").find({ id: 1 }, { with: ["customer"] });
      expect(invoice.customer).toEqual({ id: 1, name: "Acme" });
    });
  });

  it("belongsTo: attaches null when there's no matching related record", async () => {
    await withConnection(connect, async (db) => {
      // `constraint: false` = no database foreign key (e.g. legacy data), so customerId may point nowhere.
      // With the default constraint the database itself refuses such a row (see foreign-keys.test.js).
      const registry = buildInvoicingRegistry({ customerConstraint: false });
      await sync(db, registry);
      const repos = new RepositoryFactory(db, registry);

      await repos.for("invoice").create({ id: 1, customerId: 999, total: 50 });

      const [invoice] = await repos.for("invoice").find({ id: 1 }, { with: ["customer"] });
      expect(invoice.customer).toBeNull();
    });
  });

  it("hasMany: eager-loads all related records grouped correctly per parent", async () => {
    await withConnection(connect, async (db) => {
      const registry = buildInvoicingRegistry();
      await sync(db, registry);
      const repos = new RepositoryFactory(db, registry);

      await repos.for("customer").create({ id: 1, name: "Acme" });
      await repos.for("invoice").create({ id: 1, customerId: 1 });
      await repos.for("invoice").create({ id: 2, customerId: 1 });
      await repos.for("invoiceLine").create({ id: 1, invoiceId: 1, description: "Line A" });
      await repos.for("invoiceLine").create({ id: 2, invoiceId: 1, description: "Line B" });
      await repos.for("invoiceLine").create({ id: 3, invoiceId: 2, description: "Line C" });

      const invoices = await repos.for("invoice").find({}, { with: ["lines"] });
      const invoice1 = invoices.find((i) => i.id === 1);
      const invoice2 = invoices.find((i) => i.id === 2);

      expect(invoice1.lines.map((l) => l.description).sort()).toEqual(["Line A", "Line B"]);
      expect(invoice2.lines.map((l) => l.description)).toEqual(["Line C"]);
    });
  });

  it("hasMany: attaches an empty array when there are no related records", async () => {
    await withConnection(connect, async (db) => {
      const registry = buildInvoicingRegistry();
      await sync(db, registry);
      const repos = new RepositoryFactory(db, registry);

      await db("customer").insert({ id: 1, name: "Acme" });
      await repos.for("invoice").create({ id: 1, customerId: 1 });
      const [invoice] = await repos.for("invoice").find({ id: 1 }, { with: ["lines"] });
      expect(invoice.lines).toEqual([]);
    });
  });

  it("hasOne: returns a single related record or null, not an array", async () => {
    await withConnection(connect, async (db) => {
      const registry = new ModelRegistry();
      registry.define({
        name: "user",
        fields: { id: { type: "integer", required: true } },
        relations: { profile: { type: "hasOne", model: "profile", foreignKey: "userId" } },
      });
      registry.define({
        name: "profile",
        fields: {
          id: { type: "integer", required: true },
          userId: { type: "integer", required: true },
          bio: { type: "text" },
        },
      });
      await sync(db, registry);
      const repos = new RepositoryFactory(db, registry);

      await repos.for("user").create({ id: 1 });
      await repos.for("profile").create({ id: 1, userId: 1, bio: "Hello" });

      const [userWithProfile] = await repos.for("user").find({ id: 1 }, { with: ["profile"] });
      expect(userWithProfile.profile).toEqual({ id: 1, userId: 1, bio: "Hello" });
      expect(Array.isArray(userWithProfile.profile)).toBe(false);

      await repos.for("user").create({ id: 2 }); // no profile
      const [userWithoutProfile] = await repos.for("user").find({ id: 2 }, { with: ["profile"] });
      expect(userWithoutProfile.profile).toBeNull();
    });
  });

  it("belongsToMany: auto-creates the pivot table and eager-loads via it", async () => {
    await withConnection(connect, async (db) => {
      const registry = buildInvoicingRegistry();
      await sync(db, registry);

      expect(await db.schema.hasTable("invoice_tag")).toBe(true);

      const repos = new RepositoryFactory(db, registry);
      await repos.for("customer").create({ id: 1, name: "Acme" });
      await repos.for("invoice").create({ id: 1, customerId: 1 });
      await repos.for("tag").create({ id: 1, name: "urgent" });
      await repos.for("tag").create({ id: 2, name: "overdue" });
      await db("invoice_tag").insert([
        { invoice_id: 1, tag_id: 1 },
        { invoice_id: 1, tag_id: 2 },
      ]);

      const [invoice] = await repos.for("invoice").find({ id: 1 }, { with: ["tags"] });
      expect(invoice.tags.map((t) => t.name).sort()).toEqual(["overdue", "urgent"]);
    });
  });

  it("belongsToMany: attaches an empty array when there are no pivot rows", async () => {
    await withConnection(connect, async (db) => {
      const registry = buildInvoicingRegistry();
      await sync(db, registry);
      const repos = new RepositoryFactory(db, registry);
      await db("customer").insert({ id: 1, name: "Acme" });
      await repos.for("invoice").create({ id: 1, customerId: 1 });

      const [invoice] = await repos.for("invoice").find({ id: 1 }, { with: ["tags"] });
      expect(invoice.tags).toEqual([]);
    });
  });

  it("supports multiple relations eager-loaded in one find() call", async () => {
    await withConnection(connect, async (db) => {
      const registry = buildInvoicingRegistry();
      await sync(db, registry);
      const repos = new RepositoryFactory(db, registry);

      await repos.for("customer").create({ id: 1, name: "Acme" });
      await repos.for("invoice").create({ id: 1, customerId: 1 });
      await repos.for("invoiceLine").create({ id: 1, invoiceId: 1, description: "Line A" });

      const [invoice] = await repos.for("invoice").find({ id: 1 }, { with: ["customer", "lines"] });
      expect(invoice.customer.name).toBe("Acme");
      expect(invoice.lines).toHaveLength(1);
    });
  });

  describe("N+1 prevention (query-counting regression tests)", () => {
    it("hasMany eager loading issues a constant number of queries regardless of row count", async () => {
      await withConnection(connect, async (db) => {
        const registry = buildInvoicingRegistry();
        await sync(db, registry);
        const repos = new RepositoryFactory(db, registry);
        await repos.for("customer").create({ id: 1, name: "Acme" });

        // 1 invoice, 1 line each
        await repos.for("invoice").create({ id: 1, customerId: 1 });
        await repos.for("invoiceLine").create({ id: 1, invoiceId: 1 });

        const { count: countWithOne } = await countQueries(db, () =>
          repos.for("invoice").find({}, { with: ["lines"] })
        );

        // Now seed 5x as many invoices+lines
        for (let i = 2; i <= 6; i++) {
          await repos.for("invoice").create({ id: i, customerId: 1 });
          await repos.for("invoiceLine").create({ id: i, invoiceId: i });
        }

        const { count: countWithSix } = await countQueries(db, () =>
          repos.for("invoice").find({}, { with: ["lines"] })
        );

        expect(countWithOne).toBe(2); // 1 base query + 1 relation query
        expect(countWithSix).toBe(2); // same, even with 6x the rows
      });
    });

    it("belongsToMany eager loading stays at a constant (small) query count", async () => {
      await withConnection(connect, async (db) => {
        const registry = buildInvoicingRegistry();
        await sync(db, registry);
        const repos = new RepositoryFactory(db, registry);

        await repos.for("customer").create({ id: 1, name: "Acme" });
        for (let i = 1; i <= 5; i++) {
          await repos.for("invoice").create({ id: i, customerId: 1 });
          await repos.for("tag").create({ id: i, name: `tag${i}` });
          await db("invoice_tag").insert({ invoice_id: i, tag_id: i });
        }

        const { count } = await countQueries(db, () => repos.for("invoice").find({}, { with: ["tags"] }));
        expect(count).toBe(3); // 1 base + 1 pivot + 1 related, regardless of the 5 invoices/tags
      });
    });

    it("issues zero relation queries when the base result set is empty", async () => {
      await withConnection(connect, async (db) => {
        const registry = buildInvoicingRegistry();
        await sync(db, registry);
        const repos = new RepositoryFactory(db, registry);

        const { count, result } = await countQueries(db, () =>
          repos.for("invoice").find({ id: 999 }, { with: ["lines"] })
        );
        expect(result).toEqual([]);
        expect(count).toBe(1); // just the base query - no point querying for zero records' relations
      });
    });
  });

  describe("lazy loading", () => {
    it("load() fetches a relation for a single already-fetched record on demand", async () => {
      await withConnection(connect, async (db) => {
        const registry = buildInvoicingRegistry();
        await sync(db, registry);
        const repos = new RepositoryFactory(db, registry);

        await repos.for("customer").create({ id: 1, name: "Acme" });
        const invoice = await repos.for("invoice").create({ id: 1, customerId: 1 });
        expect(invoice.customer).toBeUndefined(); // not eager-loaded on create()

        const invoiceRepo = repos.for("invoice");
        const { count } = await countQueries(db, () => invoiceRepo.load(invoice, "customer"));

        expect(count).toBe(1);
        expect(invoice.customer).toEqual({ id: 1, name: "Acme" }); // mutated in place
      });
    });
  });

  describe("error handling", () => {
    it("throws RelationError for an unknown relation name", async () => {
      await withConnection(connect, async (db) => {
        const registry = buildInvoicingRegistry();
        await sync(db, registry);
        const repos = new RepositoryFactory(db, registry);
        await db("customer").insert({ id: 1, name: "Acme" });
        await repos.for("invoice").create({ id: 1, customerId: 1 });

        await expect(repos.for("invoice").find({}, { with: ["bogus"] })).rejects.toThrow(RelationError);
      });
    });

    it("throws RelationError when using `with` on a Repository built without a modelRegistry", async () => {
      await withConnection(connect, async (db) => {
        const registry = buildInvoicingRegistry();
        await sync(db, registry);
        const model = registry.getModel("invoice");
        const bareRepo = new Repository(db, model); // no modelRegistry passed

        await db("customer").insert({ id: 1, name: "Acme" });
        await bareRepo.create({ id: 1, customerId: 1 });
        await expect(bareRepo.find({}, { with: ["customer"] })).rejects.toThrow(RelationError);
      });
    });
  });

  describe("meta storage (Phase 4 integration)", () => {
    it("stores relation rows in _meta_fields alongside scalar fields", async () => {
      await withConnection(connect, async (db) => {
        const registry = buildInvoicingRegistry();
        await sync(db, registry);

        const rows = await getFieldsMeta(db, "invoice");
        const names = rows.map((r) => r.name).sort();
        expect(names).toEqual(["customer", "customerId", "id", "lines", "tags", "total"]);

        const customerRelRow = rows.find((r) => r.name === "customer");
        expect(customerRelRow.type).toBe("belongsTo");
        // SQLite hands a json column back as text, Postgres as an already-parsed object.
        const options = typeof customerRelRow.options === "string" ? JSON.parse(customerRelRow.options) : customerRelRow.options;
        expect(options.model).toBe("customer");
        expect(options.foreignKey).toBe("customerId");

        // belongsTo's meta row records the underlying FK column for reference.
        expect(customerRelRow.column).toBe("customer_id");

        // hasMany has no column of its own on this model.
        const linesRelRow = rows.find((r) => r.name === "lines");
        expect(linesRelRow.column).toBe("");
      });
    });
  });
});
