import { describe, it, expect } from "vitest";
import { eachDialect, withConnection } from "../helpers/dialects.js";
import { captureQueries } from "../helpers/sql-capture.js";
import { ModelRegistry } from "../../src/models/registry.js";
import { sync } from "../../src/schema/sync.js";
import { UnitOfWork } from "../../src/uow/unit-of-work.js";
import { withUnitOfWork } from "../../src/uow/with-unit-of-work.js";
import { HookRegistry } from "../../src/uow/hooks.js";

async function setupInvoiceRegistry(db) {
  const registry = new ModelRegistry();
  registry.define({
    name: "invoice",
    fields: {
      id: { type: "integer", required: true },
      status: { type: "enum", values: ["draft", "sent", "paid"], default: "draft" },
      total: { type: "float" },
      notes: { type: "text" },
    },
  });
  await sync(db, registry);
  return registry;
}

describe.each(eachDialect())("UnitOfWork - %s", ({ name, connect }) => {
  describe("identity map", () => {
    it("returns the exact same object reference for two loads of the same row", async () => {
      await withConnection(connect, async (db) => {
        const registry = await setupInvoiceRegistry(db);
        const uow = new UnitOfWork(db, registry);
        await uow.create("invoice", { id: 1, status: "draft" });

        const [first] = await uow.find("invoice", { id: 1 });
        const [second] = await uow.find("invoice", { id: 1 });
        expect(first).toBe(second); // same reference, not just equal content
      });
    });

    it("an in-progress unsaved edit survives a second find() (existing instance wins over a fresh read)", async () => {
      await withConnection(connect, async (db) => {
        const registry = await setupInvoiceRegistry(db);
        const uow = new UnitOfWork(db, registry);
        await uow.create("invoice", { id: 1, status: "draft" });

        const [entity] = await uow.find("invoice", { id: 1 });
        entity.status = "sent"; // unsaved edit

        const [reloaded] = await uow.find("invoice", { id: 1 });
        expect(reloaded.status).toBe("sent"); // still the in-memory edit, not "draft" from the DB
        expect(reloaded).toBe(entity);
      });
    });

    it("different UnitOfWork instances do NOT share identity - each has its own map", async () => {
      await withConnection(connect, async (db) => {
        const registry = await setupInvoiceRegistry(db);
        await sync(db, registry);
        const repo1 = new UnitOfWork(db, registry);
        const repo2 = new UnitOfWork(db, registry);
        await repo1.create("invoice", { id: 1, status: "draft" });

        const [fromFirst] = await repo1.find("invoice", { id: 1 });
        const [fromSecond] = await repo2.find("invoice", { id: 1 });
        expect(fromFirst).not.toBe(fromSecond); // different instances, scoped separately
        expect(fromFirst).toEqual(fromSecond); // but same data
      });
    });
  });

  describe("dirty tracking (verified via captured SQL, not just behavior)", () => {
    it("save() with one changed field issues an UPDATE mentioning only that column", async () => {
      await withConnection(connect, async (db) => {
        const registry = await setupInvoiceRegistry(db);
        const uow = new UnitOfWork(db, registry);
        await uow.create("invoice", { id: 1, status: "draft", total: 100, notes: "original" });

        const [entity] = await uow.find("invoice", { id: 1 });
        entity.status = "paid";

        const { queries } = await captureQueries(db, () => entity.save());
        const updateQuery = queries.find((q) => q.sql.toLowerCase().startsWith("update"));

        expect(updateQuery).toBeTruthy();
        expect(updateQuery.sql.toLowerCase()).toContain("status");
        expect(updateQuery.sql.toLowerCase()).not.toContain("total");
        expect(updateQuery.sql.toLowerCase()).not.toContain("notes");
      });
    });

    it("save() with multiple changed fields includes all of them and only them", async () => {
      await withConnection(connect, async (db) => {
        const registry = await setupInvoiceRegistry(db);
        const uow = new UnitOfWork(db, registry);
        await uow.create("invoice", { id: 1, status: "draft", total: 100, notes: "original" });

        const [entity] = await uow.find("invoice", { id: 1 });
        entity.status = "paid";
        entity.total = 250;

        const { queries } = await captureQueries(db, () => entity.save());
        const updateQuery = queries.find((q) => q.sql.toLowerCase().startsWith("update"));

        expect(updateQuery.sql.toLowerCase()).toContain("status");
        expect(updateQuery.sql.toLowerCase()).toContain("total");
        expect(updateQuery.sql.toLowerCase()).not.toContain("notes");
      });
    });

    it("save() with no changes issues zero queries - a true no-op", async () => {
      await withConnection(connect, async (db) => {
        const registry = await setupInvoiceRegistry(db);
        const uow = new UnitOfWork(db, registry);
        await uow.create("invoice", { id: 1, status: "draft" });

        const [entity] = await uow.find("invoice", { id: 1 });
        const { queries } = await captureQueries(db, () => entity.save());
        expect(queries).toEqual([]);
      });
    });

    it("save() actually persists the change (verified by a fresh, separate read)", async () => {
      await withConnection(connect, async (db) => {
        const registry = await setupInvoiceRegistry(db);
        const uow = new UnitOfWork(db, registry);
        await uow.create("invoice", { id: 1, status: "draft" });

        const [entity] = await uow.find("invoice", { id: 1 });
        entity.status = "paid";
        await entity.save();

        const row = await db("invoice").where({ id: 1 }).first();
        expect(row.status).toBe("paid");
      });
    });

    it("save() refreshes the original snapshot, so calling save() again with no further edits is a no-op", async () => {
      await withConnection(connect, async (db) => {
        const registry = await setupInvoiceRegistry(db);
        const uow = new UnitOfWork(db, registry);
        await uow.create("invoice", { id: 1, status: "draft" });

        const [entity] = await uow.find("invoice", { id: 1 });
        entity.status = "paid";
        await entity.save();

        const { queries } = await captureQueries(db, () => entity.save());
        expect(queries).toEqual([]);
      });
    });

    it("a hook-injected field (added to `dirty` but never touched by the caller) is reflected on the entity after save()", async () => {
      // Regression test for a real bug found while building a
      // multi-model example app: a beforeUpdate hook adding a NEW
      // field to `dirty` (e.g. auto-stamping publishedAt) was
      // persisted to the DB correctly, but the entity object itself
      // kept showing the stale pre-hook value, since the old code
      // copied entity's value into `original` instead of dirty's
      // final value into both.
      await withConnection(connect, async (db) => {
        const registry = await setupInvoiceRegistry(db);
        const hooks = new HookRegistry();
        hooks.on("invoice", "beforeUpdate", (entity, dirty) => {
          if (dirty.status === "paid" && !entity.notes) {
            dirty.notes = "auto-stamped by hook";
          }
        });

        const uow = new UnitOfWork(db, registry, { hooks });
        await uow.create("invoice", { id: 1, status: "draft" });
        const [entity] = await uow.find("invoice", { id: 1 });
        entity.status = "paid"; // caller only touches status directly

        await entity.save();

        expect(entity.notes).toBe("auto-stamped by hook"); // entity reflects the hook's change
        const row = await db("invoice").where({ id: 1 }).first();
        expect(row.notes).toBe("auto-stamped by hook"); // and so does the DB

        // A subsequent save() with no further edits is still a true no-op.
        const { queries } = await captureQueries(db, () => entity.save());
        expect(queries).toEqual([]);
      });
    });

    it("entity.delete() removes the row and the identity map entry", async () => {
      await withConnection(connect, async (db) => {
        const registry = await setupInvoiceRegistry(db);
        const uow = new UnitOfWork(db, registry);
        const entity = await uow.create("invoice", { id: 1 });

        await entity.delete();

        const row = await db("invoice").where({ id: 1 }).first();
        expect(row).toBeUndefined();

        const found = await uow.find("invoice", { id: 1 });
        expect(found).toEqual([]);
      });
    });
    it("a later find() with `with` refreshes relation data even on an already-tracked entity", async () => {
      // Regression test for a real bug found while building the
      // client facade: create() tracks an entity with no relations
      // loaded; a LATER find() with `with` for the same row used to
      // silently return that same cached instance untouched (the
      // "existing instance wins" identity-map policy applying to
      // relations too, which it shouldn't - relations aren't
      // protected/editable data the way fields are).
      await withConnection(connect, async (db) => {
        const registry = new ModelRegistry();
        registry.define({
          name: "customer",
          fields: { id: { type: "integer", required: true }, name: { type: "char", required: true } },
        });
        registry.define({
          name: "invoice",
          fields: { id: { type: "integer", required: true }, customerId: { type: "integer", required: true } },
          relations: { customer: { type: "belongsTo", model: "customer", foreignKey: "customerId" } },
        });
        await sync(db, registry);

        const uow = new UnitOfWork(db, registry);
        await uow.create("customer", { id: 1, name: "Acme" });
        const created = await uow.create("invoice", { id: 1, customerId: 1 });
        expect(created.customer).toBeUndefined(); // not eager-loaded on create()

        const [found] = await uow.find("invoice", { id: 1 }, { with: ["customer"] });
        expect(found).toBe(created); // still the same tracked instance...
        expect(found.customer).toEqual({ id: 1, name: "Acme" }); // ...but now has the relation data
      });
    });
  });

  describe("hooks", () => {
    it("runs beforeCreate then beforeSave before the insert, afterCreate then afterSave after it", async () => {
      await withConnection(connect, async (db) => {
        const registry = await setupInvoiceRegistry(db);
        const hooks = new HookRegistry();
        const order = [];
        hooks.on("invoice", "beforeCreate", () => order.push("beforeCreate"));
        hooks.on("invoice", "beforeSave", () => order.push("beforeSave"));
        hooks.on("invoice", "afterCreate", () => order.push("afterCreate"));
        hooks.on("invoice", "afterSave", () => order.push("afterSave"));

        const uow = new UnitOfWork(db, registry, { hooks });
        await uow.create("invoice", { id: 1 });

        expect(order).toEqual(["beforeCreate", "beforeSave", "afterCreate", "afterSave"]);
      });
    });

    it("beforeCreate can mutate the data before it's inserted", async () => {
      await withConnection(connect, async (db) => {
        const registry = await setupInvoiceRegistry(db);
        const hooks = new HookRegistry();
        hooks.on("invoice", "beforeCreate", (data) => {
          data.notes = "set by hook";
        });

        const uow = new UnitOfWork(db, registry, { hooks });
        const entity = await uow.create("invoice", { id: 1 });
        expect(entity.notes).toBe("set by hook");
      });
    });

    it("runs beforeUpdate/beforeSave then afterUpdate/afterSave around save(), with the dirty diff passed through", async () => {
      await withConnection(connect, async (db) => {
        const registry = await setupInvoiceRegistry(db);
        const hooks = new HookRegistry();
        const seenDirty = [];
        hooks.on("invoice", "beforeUpdate", (entity, dirty) => seenDirty.push(["beforeUpdate", dirty]));
        hooks.on("invoice", "afterUpdate", (entity, dirty) => seenDirty.push(["afterUpdate", dirty]));

        const uow = new UnitOfWork(db, registry, { hooks });
        await uow.create("invoice", { id: 1, status: "draft" });
        const [entity] = await uow.find("invoice", { id: 1 });
        entity.status = "paid";
        await entity.save();

        expect(seenDirty).toEqual([
          ["beforeUpdate", { status: "paid" }],
          ["afterUpdate", { status: "paid" }],
        ]);
      });
    });

    it("passes a pre-edit `original` snapshot as a third hook argument, distinct from entity's live value", async () => {
      // Regression test for a real gap found while writing a
      // transition-guard hook in a multi-module example: a hook
      // checking entity.status to see what the value WAS is wrong,
      // since entity already holds the caller's new value by the time
      // the hook runs. `original` is what a guard like this actually
      // needs.
      await withConnection(connect, async (db) => {
        const registry = await setupInvoiceRegistry(db);
        const hooks = new HookRegistry();
        hooks.on("invoice", "beforeUpdate", (entity, dirty, original) => {
          if (dirty.status === "draft" && original.status === "paid") {
            throw new Error("Cannot revert a paid invoice back to draft");
          }
        });

        const uow = new UnitOfWork(db, registry, { hooks });
        const entity = await uow.create("invoice", { id: 1, status: "draft" });
        entity.status = "paid";
        await entity.save(); // fine: draft -> paid

        entity.status = "draft";
        await expect(entity.save()).rejects.toThrow("Cannot revert a paid invoice back to draft");
      });
    });

    it("the `original` snapshot passed to afterUpdate/afterSave is also pre-edit, not post-save", async () => {
      await withConnection(connect, async (db) => {
        const registry = await setupInvoiceRegistry(db);
        const hooks = new HookRegistry();
        let seenOriginalStatus;
        hooks.on("invoice", "afterUpdate", (entity, dirty, original) => {
          seenOriginalStatus = original.status;
        });

        const uow = new UnitOfWork(db, registry, { hooks });
        const entity = await uow.create("invoice", { id: 1, status: "draft" });
        entity.status = "paid";
        await entity.save();

        expect(seenOriginalStatus).toBe("draft"); // not "paid" - that would mean it saw the post-save state
      });
    });

    it("a beforeCreate hook that throws prevents the insert entirely", async () => {
      await withConnection(connect, async (db) => {
        const registry = await setupInvoiceRegistry(db);
        const hooks = new HookRegistry();
        hooks.on("invoice", "beforeCreate", () => {
          throw new Error("validation failed in hook");
        });

        const uow = new UnitOfWork(db, registry, { hooks });
        await expect(uow.create("invoice", { id: 1 })).rejects.toThrow("validation failed in hook");

        const row = await db("invoice").where({ id: 1 }).first();
        expect(row).toBeUndefined(); // never inserted
      });
    });

    it("reverts the entity's live values to original after a failed save (hook rejection)", async () => {
      // Regression test for a real gap found while running the
      // modular-monolith example: after a beforeUpdate hook rejects a
      // change, the entity used to keep showing the rejected value
      // forever, silently diverging from what's actually in the DB.
      await withConnection(connect, async (db) => {
        const registry = await setupInvoiceRegistry(db);
        const hooks = new HookRegistry();
        hooks.on("invoice", "beforeUpdate", (entity, dirty) => {
          if (dirty.status === "sent") throw new Error("blocked");
        });

        const uow = new UnitOfWork(db, registry, { hooks });
        const entity = await uow.create("invoice", { id: 1, status: "draft" });
        entity.status = "sent";

        await expect(entity.save()).rejects.toThrow("blocked");

        expect(entity.status).toBe("draft"); // reverted, not left at the rejected "sent" value
        const row = await db("invoice").where({ id: 1 }).first();
        expect(row.status).toBe("draft"); // matches the DB, as it should
      });
    });

    it("a beforeUpdate hook that throws prevents the UPDATE entirely", async () => {
      await withConnection(connect, async (db) => {
        const registry = await setupInvoiceRegistry(db);
        const hooks = new HookRegistry();
        hooks.on("invoice", "beforeUpdate", () => {
          throw new Error("blocked");
        });

        const uow = new UnitOfWork(db, registry, { hooks });
        await uow.create("invoice", { id: 1, status: "draft" });
        const [entity] = await uow.find("invoice", { id: 1 });
        entity.status = "paid";

        await expect(entity.save()).rejects.toThrow("blocked");

        const row = await db("invoice").where({ id: 1 }).first();
        expect(row.status).toBe("draft"); // unchanged - the UPDATE never ran
      });
    });

    it("runs beforeDelete before and afterDelete after the DELETE", async () => {
      await withConnection(connect, async (db) => {
        const registry = await setupInvoiceRegistry(db);
        const hooks = new HookRegistry();
        const order = [];
        hooks.on("invoice", "beforeDelete", () => order.push("beforeDelete"));
        hooks.on("invoice", "afterDelete", () => order.push("afterDelete"));

        const uow = new UnitOfWork(db, registry, { hooks });
        const entity = await uow.create("invoice", { id: 1 });
        await entity.delete();

        expect(order).toEqual(["beforeDelete", "afterDelete"]);
      });
    });

    it("multiple hooks on the same event run in registration order", async () => {
      await withConnection(connect, async (db) => {
        const registry = await setupInvoiceRegistry(db);
        const hooks = new HookRegistry();
        const order = [];
        hooks.on("invoice", "beforeCreate", () => order.push("first"));
        hooks.on("invoice", "beforeCreate", () => order.push("second"));

        const uow = new UnitOfWork(db, registry, { hooks });
        await uow.create("invoice", { id: 1 });
        expect(order).toEqual(["first", "second"]);
      });
    });
  });

  describe("withUnitOfWork (transactional convenience wrapper)", () => {
    it("commits everything performed inside on success", async () => {
      await withConnection(connect, async (db) => {
        const registry = await setupInvoiceRegistry(db);

        await withUnitOfWork(db, registry, async (uow) => {
          await uow.create("invoice", { id: 1 });
          await uow.create("invoice", { id: 2 });
        });

        const rows = await db("invoice").select("id");
        expect(rows.map((r) => r.id).sort()).toEqual([1, 2]);
      });
    });

    it("rolls back everything if the callback throws", async () => {
      await withConnection(connect, async (db) => {
        const registry = await setupInvoiceRegistry(db);

        await expect(
          withUnitOfWork(db, registry, async (uow) => {
            await uow.create("invoice", { id: 1 });
            throw new Error("boom");
          })
        ).rejects.toThrow("boom");

        const rows = await db("invoice").select("id");
        expect(rows).toEqual([]);
      });
    });
  });
});
