import { describe, it, expect } from "vitest";
import { eachDialect, withConnection } from "../helpers/dialects.js";
import { ModelRegistry } from "../../src/models/registry.js";
import { sync } from "../../src/schema/sync.js";
import { Repository } from "../../src/crud/repository.js";
import { ValidationError } from "../../src/crud/errors.js";

async function setupInvoiceRepo(db) {
  const registry = new ModelRegistry();
  const model = registry.define({
    name: "invoice",
    fields: {
      id: { type: "integer", required: true },
      customerId: { type: "integer", required: true },
      status: { type: "enum", values: ["draft", "sent", "paid"], default: "draft" },
      total: { type: "float" },
      title: { type: "char" },
    },
  });
  await sync(db, registry);
  const repo = new Repository(db, model);
  return repo;
}

describe.each(eachDialect())("domain queries - %s", ({ name, connect }) => {
  it("equivalence: a plain-object filter and its domain-array equivalent return identical rows", async () => {
    await withConnection(connect, async (db) => {
      const repo = await setupInvoiceRepo(db);
      await repo.create({ id: 1, customerId: 1, status: "paid" });
      await repo.create({ id: 2, customerId: 1, status: "draft" });
      await repo.create({ id: 3, customerId: 2, status: "paid" });

      const viaObject = await repo.find({ customerId: 1, status: "paid" });
      const viaDomain = await repo.find([
        ["customerId", "=", 1],
        ["status", "=", "paid"],
      ]);

      expect(viaDomain).toEqual(viaObject);
      expect(viaObject.map((r) => r.id)).toEqual([1]);
    });
  });

  it("OR: returns rows matching either branch", async () => {
    await withConnection(connect, async (db) => {
      const repo = await setupInvoiceRepo(db);
      await repo.create({ id: 1, customerId: 1, status: "draft" });
      await repo.create({ id: 2, customerId: 1, status: "sent" });
      await repo.create({ id: 3, customerId: 1, status: "paid" });

      const rows = await repo.find(["|", ["status", "=", "draft"], ["status", "=", "sent"]]);
      expect(rows.map((r) => r.id).sort()).toEqual([1, 2]);
    });
  });

  it("nested AND-inside-OR: matches the correct rows with real seeded data", async () => {
    await withConnection(connect, async (db) => {
      const repo = await setupInvoiceRepo(db);
      await repo.create({ id: 1, customerId: 1, status: "paid", total: 150 }); // matches: paid AND total>100
      await repo.create({ id: 2, customerId: 1, status: "paid", total: 50 }); // no: paid but total<=100
      await repo.create({ id: 3, customerId: 1, status: "draft", total: 10 }); // matches: status=draft branch
      await repo.create({ id: 4, customerId: 1, status: "sent", total: 10 }); // no match either branch

      const domain = [
        "|",
        ["&", ["status", "=", "paid"], ["total", ">", 100]],
        ["status", "=", "draft"],
      ];
      const rows = await repo.find(domain);
      expect(rows.map((r) => r.id).sort()).toEqual([1, 3]);
    });
  });

  it("NOT: excludes matching rows", async () => {
    await withConnection(connect, async (db) => {
      const repo = await setupInvoiceRepo(db);
      await repo.create({ id: 1, customerId: 1, status: "draft" });
      await repo.create({ id: 2, customerId: 1, status: "paid" });

      const rows = await repo.find(["!", ["status", "=", "draft"]]);
      expect(rows.map((r) => r.id)).toEqual([2]);
    });
  });

  it("'in' matches any value from the array", async () => {
    await withConnection(connect, async (db) => {
      const repo = await setupInvoiceRepo(db);
      await repo.create({ id: 1, customerId: 1, status: "draft" });
      await repo.create({ id: 2, customerId: 1, status: "sent" });
      await repo.create({ id: 3, customerId: 1, status: "paid" });

      const rows = await repo.find([["status", "in", ["draft", "paid"]]]);
      expect(rows.map((r) => r.id).sort()).toEqual([1, 3]);
    });
  });

  it("'not in' excludes any value from the array", async () => {
    await withConnection(connect, async (db) => {
      const repo = await setupInvoiceRepo(db);
      await repo.create({ id: 1, customerId: 1, status: "draft" });
      await repo.create({ id: 2, customerId: 1, status: "sent" });
      await repo.create({ id: 3, customerId: 1, status: "paid" });

      const rows = await repo.find([["status", "not in", ["draft", "sent"]]]);
      expect(rows.map((r) => r.id)).toEqual([3]);
    });
  });

  it("'like' matches a substring pattern", async () => {
    await withConnection(connect, async (db) => {
      const repo = await setupInvoiceRepo(db);
      await repo.create({ id: 1, customerId: 1, title: "January Invoice" });
      await repo.create({ id: 2, customerId: 1, title: "February Invoice" });
      await repo.create({ id: 3, customerId: 1, title: "Receipt" });

      const rows = await repo.find([["title", "like", "%Invoice%"]]);
      expect(rows.map((r) => r.id).sort()).toEqual([1, 2]);
    });
  });

  it("'ilike' matches case-insensitively", async () => {
    await withConnection(connect, async (db) => {
      const repo = await setupInvoiceRepo(db);
      await repo.create({ id: 1, customerId: 1, title: "URGENT" });
      await repo.create({ id: 2, customerId: 1, title: "urgent" });
      await repo.create({ id: 3, customerId: 1, title: "normal" });

      const rows = await repo.find([["title", "ilike", "%urgent%"]]);
      expect(rows.map((r) => r.id).sort()).toEqual([1, 2]);
    });
  });

  it("null checks: '=' null matches missing values, '!=' null matches present ones", async () => {
    await withConnection(connect, async (db) => {
      const repo = await setupInvoiceRepo(db);
      await repo.create({ id: 1, customerId: 1, total: 100 });
      await repo.create({ id: 2, customerId: 1 }); // total omitted -> null

      const nullRows = await repo.find([["total", "=", null]]);
      expect(nullRows.map((r) => r.id)).toEqual([2]);

      const notNullRows = await repo.find([["total", "!=", null]]);
      expect(notNullRows.map((r) => r.id)).toEqual([1]);
    });
  });

  it("domain filters work with update() too, and only touch matching rows", async () => {
    await withConnection(connect, async (db) => {
      const repo = await setupInvoiceRepo(db);
      await repo.create({ id: 1, customerId: 1, status: "draft" });
      await repo.create({ id: 2, customerId: 1, status: "sent" });

      const affected = await repo.update([["status", "=", "draft"]], { status: "paid" });
      expect(affected).toBe(1);

      const rows = await repo.find();
      expect(rows.find((r) => r.id === 1).status).toBe("paid");
      expect(rows.find((r) => r.id === 2).status).toBe("sent"); // untouched
    });
  });

  it("domain filters work with delete() too", async () => {
    await withConnection(connect, async (db) => {
      const repo = await setupInvoiceRepo(db);
      await repo.create({ id: 1, customerId: 1, status: "draft" });
      await repo.create({ id: 2, customerId: 1, status: "sent" });

      const affected = await repo.delete([["status", "=", "draft"]]);
      expect(affected).toBe(1);

      const remaining = await repo.find();
      expect(remaining.map((r) => r.id)).toEqual([2]);
    });
  });

  it("delete() refuses an empty domain array, same as it refuses an empty object", async () => {
    await withConnection(connect, async (db) => {
      const repo = await setupInvoiceRepo(db);
      await repo.create({ id: 1, customerId: 1 });

      await expect(repo.delete([])).rejects.toThrow(ValidationError);
      const rows = await repo.find();
      expect(rows).toHaveLength(1); // nothing was deleted
    });
  });

  it("find() with a domain surfaces a compile-time field-name error before touching the DB", async () => {
    await withConnection(connect, async (db) => {
      const repo = await setupInvoiceRepo(db);
      await expect(repo.find([["nonexistentField", "=", 1]])).rejects.toThrow();
    });
  });
});
