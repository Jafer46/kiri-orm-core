import { describe, it, expect } from "vitest";
import { eachDialect, withConnection } from "../helpers/dialects.js";
import { ModelRegistry } from "../../src/models/registry.js";
import { sync } from "../../src/schema/sync.js";
import { diffSchema } from "../../src/migrations/diff.js";
import { generateMigration } from "../../src/migrations/generate.js";
import { describePlan } from "../../src/migrations/describe.js";
import { applyMigration, rollbackMigration } from "../../src/migrations/apply.js";
import { MigrationSafetyError } from "../../src/migrations/errors.js";

describe.each(eachDialect())("migrations - %s", ({ name, connect }) => {
  it("reports no changes when the registry matches the last synced state", async () => {
    await withConnection(connect, async (db) => {
      const registry = new ModelRegistry();
      registry.define({ name: "invoice", fields: { id: { type: "integer", required: true } } });
      await sync(db, registry);

      const plan = await diffSchema(db, registry);
      expect(plan.createModels).toEqual([]);
      expect(plan.dropModels).toEqual([]);
      expect(Object.keys(plan.fieldChanges)).toEqual([]);
      expect(describePlan(plan)).toEqual(["(no changes - registry matches the last synced state)"]);
    });
  });

  describe("add field (safe)", () => {
    it("diffs, generates, applies, and rolls back an added field", async () => {
      await withConnection(connect, async (db) => {
        const registryA = new ModelRegistry();
        registryA.define({
          name: "invoice",
          fields: { id: { type: "integer", required: true } },
        });
        await sync(db, registryA);
        await db("invoice").insert({ id: 1 });

        const registryB = new ModelRegistry();
        registryB.define({
          name: "invoice",
          fields: {
            id: { type: "integer", required: true },
            total: { type: "float" },
          },
        });

        const plan = await diffSchema(db, registryB);
        expect(plan.fieldChanges.invoice.addFields).toEqual(["total"]);

        const migration = generateMigration(plan, registryB); // no allowDestructive needed - it's safe
        await applyMigration(db, migration);

        let columns = await db("invoice").columnInfo();
        expect(columns).toHaveProperty("total");

        await db("invoice").where({ id: 1 }).update({ total: 42.5 });
        const row = await db("invoice").where({ id: 1 }).first();
        expect(row.total).toBe(42.5);

        await rollbackMigration(db, migration);
        columns = await db("invoice").columnInfo();
        expect(columns).not.toHaveProperty("total");

        // The original row survives a column add + rollback.
        const survivingRow = await db("invoice").where({ id: 1 }).first();
        expect(survivingRow.id).toBe(1);
      });
    });
  });

  describe("drop field (destructive)", () => {
    it("refuses to generate a migration without allowDestructive", async () => {
      await withConnection(connect, async (db) => {
        const registryA = new ModelRegistry();
        registryA.define({
          name: "invoice",
          fields: {
            id: { type: "integer", required: true },
            notes: { type: "text" },
          },
        });
        await sync(db, registryA);

        const registryB = new ModelRegistry();
        registryB.define({ name: "invoice", fields: { id: { type: "integer", required: true } } });

        const plan = await diffSchema(db, registryB);
        expect(plan.fieldChanges.invoice.dropFields.map((d) => d.fieldName)).toEqual(["notes"]);
        expect(() => generateMigration(plan, registryB)).toThrow(MigrationSafetyError);
      });
    });

    it("applies and reverses (schema-level) with allowDestructive: true", async () => {
      await withConnection(connect, async (db) => {
        const registryA = new ModelRegistry();
        registryA.define({
          name: "invoice",
          fields: {
            id: { type: "integer", required: true },
            notes: { type: "text" },
          },
        });
        await sync(db, registryA);
        await db("invoice").insert({ id: 1, notes: "will be dropped" });

        const registryB = new ModelRegistry();
        registryB.define({ name: "invoice", fields: { id: { type: "integer", required: true } } });

        const plan = await diffSchema(db, registryB);
        const migration = generateMigration(plan, registryB, { allowDestructive: true });
        await applyMigration(db, migration);

        let columns = await db("invoice").columnInfo();
        expect(columns).not.toHaveProperty("notes");
        // Other data on the same row survives - only the dropped
        // column's data is gone, not the whole row.
        const row = await db("invoice").where({ id: 1 }).first();
        expect(row.id).toBe(1);

        await rollbackMigration(db, migration);
        columns = await db("invoice").columnInfo();
        expect(columns).toHaveProperty("notes"); // schema restored...
        const restoredRow = await db("invoice").where({ id: 1 }).first();
        expect(restoredRow.notes).toBeNull(); // ...but the old value is gone (documented limitation)
      });
    });
  });

  describe("drop model (destructive)", () => {
    it("refuses without allowDestructive, and restores full schema on rollback with it", async () => {
      await withConnection(connect, async (db) => {
        const registryA = new ModelRegistry();
        registryA.define({
          name: "customer",
          fields: {
            id: { type: "integer", required: true },
            email: { type: "char", required: true },
          },
        });
        await sync(db, registryA);

        const registryB = new ModelRegistry(); // customer no longer registered at all

        const plan = await diffSchema(db, registryB);
        expect(plan.dropModels.map((d) => d.modelName)).toEqual(["customer"]);
        expect(() => generateMigration(plan, registryB)).toThrow(MigrationSafetyError);

        const migration = generateMigration(plan, registryB, { allowDestructive: true });
        await applyMigration(db, migration);
        expect(await db.schema.hasTable("customer")).toBe(false);

        await rollbackMigration(db, migration);
        expect(await db.schema.hasTable("customer")).toBe(true);

        // The restored table enforces the original constraints
        // (required=true -> NOT NULL), reconstructed from the field
        // descriptor Phase 4 stored in _meta_fields.options.
        await expect(db("customer").insert({ id: 1, email: null })).rejects.toBeTruthy();
        await db("customer").insert({ id: 1, email: "a@example.com" });
        const row = await db("customer").first();
        expect(row.email).toBe("a@example.com");
      });
    });
  });

  describe("type change (always refused)", () => {
    it("throws MigrationSafetyError even with allowDestructive: true", async () => {
      await withConnection(connect, async (db) => {
        const registryA = new ModelRegistry();
        registryA.define({
          name: "invoice",
          fields: { id: { type: "integer", required: true }, amount: { type: "integer" } },
        });
        await sync(db, registryA);

        const registryB = new ModelRegistry();
        registryB.define({
          name: "invoice",
          fields: { id: { type: "integer", required: true }, amount: { type: "float" } },
        });

        const plan = await diffSchema(db, registryB);
        expect(plan.fieldChanges.invoice.typeChanges).toEqual([
          { fieldName: "amount", from: "integer", to: "float" },
        ]);
        expect(() => generateMigration(plan, registryB, { allowDestructive: true })).toThrow(
          MigrationSafetyError
        );
      });
    });
  });

  describe("table rename - detected exactly, same model identity (Case 1)", () => {
    it("detects the rename with no modelRenames input, applies and rolls back with data intact", async () => {
      await withConnection(connect, async (db) => {
        const registryA = new ModelRegistry();
        registryA.define({
          name: "invoice",
          table: "invoices_v1",
          fields: { id: { type: "integer", required: true } },
        });
        await sync(db, registryA);
        await db("invoices_v1").insert({ id: 1 });

        const registryB = new ModelRegistry();
        registryB.define({
          name: "invoice", // same identity
          table: "invoices_v2", // different resolved table
          fields: { id: { type: "integer", required: true } },
        });

        const plan = await diffSchema(db, registryB); // no modelRenames option passed at all
        expect(plan.renameModels).toEqual([
          { modelName: "invoice", fromTable: "invoices_v1", toTable: "invoices_v2" },
        ]);
        expect(plan.dropModels).toEqual([]);
        expect(plan.createModels).toEqual([]);

        const migration = generateMigration(plan, registryB); // safe - no allowDestructive needed
        await applyMigration(db, migration);

        expect(await db.schema.hasTable("invoices_v2")).toBe(true);
        expect(await db.schema.hasTable("invoices_v1")).toBe(false);
        const row = await db("invoices_v2").where({ id: 1 }).first();
        expect(row).toBeTruthy(); // data survived the rename

        await rollbackMigration(db, migration);
        expect(await db.schema.hasTable("invoices_v1")).toBe(true);
        expect(await db.schema.hasTable("invoices_v2")).toBe(false);
      });
    });
  });

  describe("column rename - detected exactly, same field identity (Case 1)", () => {
    it("detects the rename automatically and preserves data through apply + rollback", async () => {
      await withConnection(connect, async (db) => {
        const registryA = new ModelRegistry();
        registryA.define({
          name: "invoice",
          fields: { customerId: { type: "integer", required: true } },
        });
        await sync(db, registryA);
        await db("invoice").insert({ customer_id: 7 });

        const registryB = new ModelRegistry();
        registryB.define({
          name: "invoice",
          fields: { customerId: { type: "integer", required: true, column: "cust_id" } },
        });

        const plan = await diffSchema(db, registryB); // no fieldRenames needed
        expect(plan.fieldChanges.invoice.columnRenames).toEqual([
          { fieldName: "customerId", fromColumn: "customer_id", toColumn: "cust_id" },
        ]);

        const migration = generateMigration(plan, registryB);
        await applyMigration(db, migration);

        const columns = await db("invoice").columnInfo();
        expect(columns).toHaveProperty("cust_id");
        expect(columns).not.toHaveProperty("customer_id");
        const row = await db("invoice").first();
        expect(row.cust_id).toBe(7); // data survived

        await rollbackMigration(db, migration);
        const revertedColumns = await db("invoice").columnInfo();
        expect(revertedColumns).toHaveProperty("customer_id");
      });
    });
  });

  describe("field rename in code - genuinely ambiguous (Case 2), needs explicit resolution", () => {
    it("treats it as drop+add and flags it as a possible rename when unresolved", async () => {
      await withConnection(connect, async (db) => {
        const registryA = new ModelRegistry();
        registryA.define({
          name: "invoice",
          fields: {
            id: { type: "integer", required: true },
            customerId: { type: "integer" },
          },
        });
        await sync(db, registryA);

        const registryB = new ModelRegistry();
        registryB.define({
          name: "invoice",
          fields: {
            id: { type: "integer", required: true },
            clientId: { type: "integer" }, // renamed in code, no fieldRenames given
          },
        });

        const plan = await diffSchema(db, registryB);
        expect(plan.fieldChanges.invoice.dropFields.map((d) => d.fieldName)).toEqual(["customerId"]);
        expect(plan.fieldChanges.invoice.addFields).toEqual(["clientId"]);
        expect(plan.fieldChanges.invoice.possibleFieldRenames).toEqual({
          removed: ["customerId"],
          added: ["clientId"],
        });

        const description = describePlan(plan);
        expect(description.some((l) => l.includes("[ambiguous]"))).toBe(true);
        expect(() => generateMigration(plan, registryB)).toThrow(MigrationSafetyError);
      });
    });

    it("becomes a safe, data-preserving rename once resolved via fieldRenames", async () => {
      await withConnection(connect, async (db) => {
        const registryA = new ModelRegistry();
        registryA.define({
          name: "invoice",
          fields: {
            id: { type: "integer", required: true },
            customerId: { type: "integer" },
          },
        });
        await sync(db, registryA);
        await db("invoice").insert({ id: 1, customer_id: 99 });

        const registryB = new ModelRegistry();
        registryB.define({
          name: "invoice",
          fields: {
            id: { type: "integer", required: true },
            clientId: { type: "integer" },
          },
        });

        const plan = await diffSchema(db, registryB, {
          fieldRenames: { invoice: { customerId: "clientId" } },
        });

        expect(plan.fieldChanges.invoice.dropFields).toEqual([]);
        expect(plan.fieldChanges.invoice.addFields).toEqual([]);
        expect(plan.fieldChanges.invoice.renameFields).toEqual([
          { from: "customerId", to: "clientId", fromColumn: "customer_id", toColumn: "client_id" },
        ]);

        const migration = generateMigration(plan, registryB); // safe, no allowDestructive
        await applyMigration(db, migration);

        const columns = await db("invoice").columnInfo();
        expect(columns).toHaveProperty("client_id");
        expect(columns).not.toHaveProperty("customer_id");
        const row = await db("invoice").where({ id: 1 }).first();
        expect(row.client_id).toBe(99); // data preserved through the rename

        await rollbackMigration(db, migration);
        const revertedColumns = await db("invoice").columnInfo();
        expect(revertedColumns).toHaveProperty("customer_id");
      });
    });
  });

  describe("end-to-end workflow with sync()", () => {
    it("a migration followed by sync() leaves the registry and meta-tables in agreement", async () => {
      await withConnection(connect, async (db) => {
        const registryA = new ModelRegistry();
        registryA.define({
          name: "invoice",
          fields: { id: { type: "integer", required: true } },
        });
        await sync(db, registryA);

        const registryB = new ModelRegistry();
        registryB.define({
          name: "invoice",
          fields: {
            id: { type: "integer", required: true },
            total: { type: "float" },
          },
        });

        const plan = await diffSchema(db, registryB);
        const migration = generateMigration(plan, registryB);
        await applyMigration(db, migration);
        await sync(db, registryB); // refresh meta to match the new reality

        const secondPlan = await diffSchema(db, registryB);
        expect(describePlan(secondPlan)).toEqual([
          "(no changes - registry matches the last synced state)",
        ]);
      });
    });
  });
});
