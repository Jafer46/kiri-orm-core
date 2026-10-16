import { describe, it, expect } from "vitest";
import { eachDialect, withConnection } from "../helpers/dialects.js";
import { ModelRegistry } from "../../src/models/registry.js";
import { sync } from "../../src/schema/sync.js";

describe.each(eachDialect())("sync - %s", ({ name, connect }) => {
  it("creates a table with columns matching the model's fields", async () => {
    await withConnection(connect, async (db) => {
      const registry = new ModelRegistry();
      registry.define({
        name: "invoice",
        fields: {
          id: { type: "integer", required: true },
          customerId: { type: "integer", required: true },
          status: { type: "enum", values: ["draft", "sent", "paid"], default: "draft" },
          total: { type: "float" },
          notes: { type: "text" },
        },
      });

      const result = await sync(db, registry);
      expect(result.tablesCreated).toEqual(["invoice"]);

      const exists = await db.schema.hasTable("invoice");
      expect(exists).toBe(true);

      const columns = await db("invoice").columnInfo();
      expect(Object.keys(columns).sort()).toEqual(
        ["id", "customer_id", "status", "total", "notes"].sort()
      );
    });
  });

  it("is idempotent - a second sync() with no model changes does nothing", async () => {
    await withConnection(connect, async (db) => {
      const registry = new ModelRegistry();
      registry.define({
        name: "invoice",
        fields: { id: { type: "integer", required: true } },
      });

      const first = await sync(db, registry);
      expect(first.tablesCreated).toEqual(["invoice"]);

      const second = await sync(db, registry);
      expect(second.tablesCreated).toEqual([]);
      expect(second.columnsAdded).toEqual({});
    });
  });

  it("additively adds a column when a model gains a field between syncs", async () => {
    await withConnection(connect, async (db) => {
      const firstRegistry = new ModelRegistry();
      firstRegistry.define({
        name: "invoice",
        fields: { id: { type: "integer", required: true } },
      });
      await sync(db, firstRegistry);

      const secondRegistry = new ModelRegistry();
      secondRegistry.define({
        name: "invoice",
        fields: {
          id: { type: "integer", required: true },
          total: { type: "float" },
        },
      });
      const result = await sync(db, secondRegistry);

      expect(result.tablesCreated).toEqual([]);
      expect(result.columnsAdded).toEqual({ invoice: ["total"] });

      const columns = await db("invoice").columnInfo();
      expect(Object.keys(columns).sort()).toEqual(["id", "total"]);
    });
  });

  it("enforces NOT NULL for required fields", async () => {
    await withConnection(connect, async (db) => {
      const registry = new ModelRegistry();
      registry.define({
        name: "customer",
        fields: {
          id: { type: "integer", required: true },
          email: { type: "char", required: true },
        },
      });
      await sync(db, registry);

      await expect(
        db("customer").insert({ id: 1, email: null })
      ).rejects.toBeTruthy();
    });
  });

  it("enforces UNIQUE constraints", async () => {
    await withConnection(connect, async (db) => {
      const registry = new ModelRegistry();
      registry.define({
        name: "customer",
        fields: {
          id: { type: "integer", required: true },
          email: { type: "char", required: true, unique: true },
        },
      });
      await sync(db, registry);

      await db("customer").insert({ id: 1, email: "a@example.com" });
      await expect(
        db("customer").insert({ id: 2, email: "a@example.com" })
      ).rejects.toBeTruthy();
    });
  });

  it("applies a static default value at the DB level", async () => {
    await withConnection(connect, async (db) => {
      const registry = new ModelRegistry();
      registry.define({
        name: "invoice",
        fields: {
          id: { type: "integer", required: true },
          status: { type: "enum", values: ["draft", "sent"], default: "draft" },
        },
      });
      await sync(db, registry);

      await db("invoice").insert({ id: 1 });
      const row = await db("invoice").where({ id: 1 }).first();
      expect(row.status).toBe("draft");
    });
  });

  it("enforces enum constraints at the DB level", async () => {
    await withConnection(connect, async (db) => {
      const registry = new ModelRegistry();
      registry.define({
        name: "invoice",
        fields: {
          id: { type: "integer", required: true },
          status: { type: "enum", values: ["draft", "sent"] },
        },
      });
      await sync(db, registry);

      await expect(
        db("invoice").insert({ id: 1, status: "not-a-valid-status" })
      ).rejects.toBeTruthy();
    });
  });

  it("honors an explicit column name mapping", async () => {
    await withConnection(connect, async (db) => {
      const registry = new ModelRegistry();
      registry.define({
        name: "invoice",
        fields: {
          id: { type: "integer", required: true },
          customerId: { type: "integer", column: "cust_id" },
        },
      });
      await sync(db, registry);

      const columns = await db("invoice").columnInfo();
      expect(columns).toHaveProperty("cust_id");
      expect(columns).not.toHaveProperty("customer_id");
    });
  });
});
