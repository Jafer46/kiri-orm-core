import { describe, it, expect } from "vitest";
import { eachDialect, withConnection } from "../helpers/dialects.js";
import { ModelRegistry } from "../../src/models/registry.js";
import { sync } from "../../src/schema/sync.js";
import { getModelMeta, getFieldsMeta, listModelsMeta } from "../../src/meta/query.js";
import { ModelConflictError } from "../../src/models/errors.js";
import { META_MODELS_TABLE, META_FIELDS_TABLE } from "../../src/meta/reserved-tables.js";

describe.each(eachDialect())("meta-tables - %s", ({ name, connect }) => {
  it("creates the _meta_models and _meta_fields tables on sync()", async () => {
    await withConnection(connect, async (db) => {
      const registry = new ModelRegistry();
      registry.define({ name: "invoice", fields: { id: { type: "integer", required: true } } });

      await sync(db, registry);

      expect(await db.schema.hasTable(META_MODELS_TABLE)).toBe(true);
      expect(await db.schema.hasTable(META_FIELDS_TABLE)).toBe(true);
    });
  });

  it("answers 'what fields does model X have' via a plain query - no source reading required", async () => {
    await withConnection(connect, async (db) => {
      const registry = new ModelRegistry();
      registry.define({
        name: "invoice",
        fields: {
          id: { type: "integer", required: true },
          customerId: { type: "integer", required: true },
          status: { type: "enum", values: ["draft", "sent"], default: "draft" },
        },
      });
      await sync(db, registry);

      // Plain SQL-level query, not touching the registry object at all.
      const rows = await db(META_FIELDS_TABLE).where({ model: "invoice" }).orderBy("name");

      expect(rows.map((r) => r.name)).toEqual(["customerId", "id", "status"]);
      const statusRow = rows.find((r) => r.name === "status");
      expect(statusRow.type).toBe("enum");
      expect(statusRow.column).toBe("status");
      expect(Boolean(statusRow.required)).toBe(false);
    });
  });

  it("records the resolved table name and column names correctly", async () => {
    await withConnection(connect, async (db) => {
      const registry = new ModelRegistry();
      registry.define({
        name: "invoice",
        fields: { customerId: { type: "integer" } },
      });
      await sync(db, registry);

      const modelRow = await getModelMeta(db, "invoice");
      expect(modelRow.table_name).toBe("invoice");

      const fieldRows = await getFieldsMeta(db, "invoice");
      expect(fieldRows[0].column).toBe("customer_id");
    });
  });

  it("stores the full field descriptor as JSON in `options`", async () => {
    await withConnection(connect, async (db) => {
      const registry = new ModelRegistry();
      registry.define({
        name: "invoice",
        fields: { status: { type: "enum", values: ["draft", "sent"], default: "draft" } },
      });
      await sync(db, registry);

      const [fieldRow] = await getFieldsMeta(db, "invoice");
      const options =
        typeof fieldRow.options === "string" ? JSON.parse(fieldRow.options) : fieldRow.options;
      expect(options.values).toEqual(["draft", "sent"]);
      expect(options.default).toBe("draft");
    });
  });

  it("is idempotent - a second sync() with no changes does not duplicate meta rows", async () => {
    await withConnection(connect, async (db) => {
      const registry = new ModelRegistry();
      registry.define({
        name: "invoice",
        fields: { id: { type: "integer", required: true } },
      });

      await sync(db, registry);
      await sync(db, registry);

      const modelRows = await db(META_MODELS_TABLE).where({ name: "invoice" });
      expect(modelRows).toHaveLength(1);

      const fieldRows = await db(META_FIELDS_TABLE).where({ model: "invoice" });
      expect(fieldRows).toHaveLength(1);
    });
  });

  it("flags a removed field with removed_at instead of deleting its meta row", async () => {
    await withConnection(connect, async (db) => {
      const firstRegistry = new ModelRegistry();
      firstRegistry.define({
        name: "invoice",
        fields: {
          id: { type: "integer", required: true },
          notes: { type: "text" },
        },
      });
      await sync(db, firstRegistry);

      const secondRegistry = new ModelRegistry();
      secondRegistry.define({
        name: "invoice",
        fields: { id: { type: "integer", required: true } },
      });
      const result = await sync(db, secondRegistry);

      expect(result.meta.fieldsRemoved).toEqual(["invoice.notes"]);

      // Still present in a raw query - not deleted.
      const raw = await db(META_FIELDS_TABLE).where({ model: "invoice", name: "notes" }).first();
      expect(raw).toBeTruthy();
      expect(raw.removed_at).not.toBeNull();

      // But excluded from the "active fields" convenience query.
      const active = await getFieldsMeta(db, "invoice");
      expect(active.map((r) => r.name)).toEqual(["id"]);
    });
  });

  it("clears removed_at if a previously-removed field reappears", async () => {
    await withConnection(connect, async (db) => {
      const withNotes = () => {
        const r = new ModelRegistry();
        r.define({
          name: "invoice",
          fields: { id: { type: "integer", required: true }, notes: { type: "text" } },
        });
        return r;
      };
      const withoutNotes = () => {
        const r = new ModelRegistry();
        r.define({ name: "invoice", fields: { id: { type: "integer", required: true } } });
        return r;
      };

      await sync(db, withNotes());
      await sync(db, withoutNotes());
      await sync(db, withNotes());

      const active = await getFieldsMeta(db, "invoice");
      expect(active.map((r) => r.name).sort()).toEqual(["id", "notes"]);
    });
  });

  it("flags a removed model with removed_at instead of deleting its meta row", async () => {
    await withConnection(connect, async (db) => {
      const firstRegistry = new ModelRegistry();
      firstRegistry.define({ name: "invoice", fields: { id: { type: "integer" } } });
      firstRegistry.define({ name: "customer", fields: { id: { type: "integer" } } });
      await sync(db, firstRegistry);

      const secondRegistry = new ModelRegistry();
      secondRegistry.define({ name: "invoice", fields: { id: { type: "integer" } } });
      const result = await sync(db, secondRegistry);

      expect(result.meta.modelsRemoved).toEqual(["customer"]);

      const raw = await db(META_MODELS_TABLE).where({ name: "customer" }).first();
      expect(raw).toBeTruthy();
      expect(raw.removed_at).not.toBeNull();

      const activeModels = await listModelsMeta(db);
      expect(activeModels.map((r) => r.name)).toEqual(["invoice"]);
    });
  });

  it("rejects a model whose table name collides with the reserved meta-table prefix", async () => {
    await withConnection(connect, async (db) => {
      const registry = new ModelRegistry();
      expect(() =>
        registry.define({
          name: "somethingCustom",
          table: "_meta_models",
          fields: { id: { type: "integer" } },
        })
      ).toThrow(ModelConflictError);
    });
  });
});
