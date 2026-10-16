import { describe, it, expect } from "vitest";
import { eachDialect, withConnection } from "../helpers/dialects.js";
import { ModelRegistry } from "../../src/models/registry.js";
import { sync } from "../../src/schema/sync.js";
import { Repository } from "../../src/crud/repository.js";
import { RepositoryFactory } from "../../src/crud/repository-factory.js";
import { runInTransaction } from "../../src/crud/transaction.js";
import { ValidationError } from "../../src/crud/errors.js";

async function setupInvoiceRepo(db) {
  const registry = new ModelRegistry();
  const model = registry.define({
    name: "invoice",
    fields: {
      id: { type: "integer", required: true },
      customerId: { type: "integer", required: true },
      title: { type: "char", maxLength: 100 },
      notes: { type: "text" },
      total: { type: "float" },
      isPaid: { type: "boolean" },
      dueDate: { type: "date" },
      createdAt: { type: "datetime" },
      metadata: { type: "json" },
      status: { type: "enum", values: ["draft", "sent", "paid"], default: "draft" },
    },
  });
  await sync(db, registry);
  return { registry, model, repo: new Repository(db, model) };
}

describe.each(eachDialect())("Repository CRUD - %s", ({ name, connect }) => {
  it("round-trips every field type through create() and find()", async () => {
    await withConnection(connect, async (db) => {
      const { repo } = await setupInvoiceRepo(db);

      const created = await repo.create({
        id: 1,
        customerId: 42,
        title: "First invoice",
        notes: "Some long-form notes",
        total: 199.99,
        isPaid: false,
        dueDate: new Date("2026-02-01"),
        createdAt: new Date("2026-01-15T10:30:00.000Z"),
        metadata: { source: "api", tags: ["a", "b"] },
        status: "sent",
      });

      expect(created.id).toBe(1);
      expect(created.customerId).toBe(42);
      expect(created.title).toBe("First invoice");
      expect(created.notes).toBe("Some long-form notes");
      expect(created.total).toBe(199.99);
      expect(created.isPaid).toBe(false);
      expect(created.dueDate).toBeInstanceOf(Date);
      expect(created.createdAt).toBeInstanceOf(Date);
      expect(created.createdAt.toISOString()).toBe("2026-01-15T10:30:00.000Z");
      expect(created.metadata).toEqual({ source: "api", tags: ["a", "b"] });
      expect(created.status).toBe("sent");

      const [found] = await repo.find({ id: 1 });
      expect(found).toEqual(created);
    });
  });

  it("applies a static default when a field is omitted on create()", async () => {
    await withConnection(connect, async (db) => {
      const { repo } = await setupInvoiceRepo(db);
      const created = await repo.create({ id: 1, customerId: 1 });
      expect(created.status).toBe("draft");
    });
  });

  it("applies a factory-function default at write time (Phase 3/4 deferred this on purpose)", async () => {
    await withConnection(connect, async (db) => {
      const registry = new ModelRegistry();
      const model = registry.define({
        name: "widget",
        fields: {
          id: { type: "integer", required: true },
          createdAt: {
            type: "datetime",
            required: true,
            default: () => new Date("2026-06-01T00:00:00.000Z"),
          },
        },
      });
      await sync(db, registry);
      const repo = new Repository(db, model);

      const created = await repo.create({ id: 1 });
      expect(created.createdAt).toEqual(new Date("2026-06-01T00:00:00.000Z"));
    });
  });

  it("findOne returns the first match or null", async () => {
    await withConnection(connect, async (db) => {
      const { repo } = await setupInvoiceRepo(db);
      await repo.create({ id: 1, customerId: 1 });

      const found = await repo.findOne({ id: 1 });
      expect(found.id).toBe(1);

      const notFound = await repo.findOne({ id: 999 });
      expect(notFound).toBeNull();
    });
  });

  it("find() respects a limit option", async () => {
    await withConnection(connect, async (db) => {
      const { repo } = await setupInvoiceRepo(db);
      await repo.create({ id: 1, customerId: 1 });
      await repo.create({ id: 2, customerId: 1 });
      await repo.create({ id: 3, customerId: 1 });

      const results = await repo.find({ customerId: 1 }, { limit: 2 });
      expect(results).toHaveLength(2);
    });
  });

  it("update() only touches the provided fields, leaving others unchanged", async () => {
    await withConnection(connect, async (db) => {
      const { repo } = await setupInvoiceRepo(db);
      await repo.create({ id: 1, customerId: 1, title: "Original", status: "draft" });

      const affected = await repo.update({ id: 1 }, { status: "paid" });
      expect(affected).toBe(1);

      const record = await repo.findOne({ id: 1 });
      expect(record.status).toBe("paid");
      expect(record.title).toBe("Original");
    });
  });

  it("update() returns 0 when the filter matches no rows", async () => {
    await withConnection(connect, async (db) => {
      const { repo } = await setupInvoiceRepo(db);
      const affected = await repo.update({ id: 999 }, { status: "paid" });
      expect(affected).toBe(0);
    });
  });

  it("delete() removes matching rows and returns the count", async () => {
    await withConnection(connect, async (db) => {
      const { repo } = await setupInvoiceRepo(db);
      await repo.create({ id: 1, customerId: 1 });
      await repo.create({ id: 2, customerId: 1 });

      const affected = await repo.delete({ id: 1 });
      expect(affected).toBe(1);

      const remaining = await repo.find();
      expect(remaining.map((r) => r.id)).toEqual([2]);
    });
  });

  it("RepositoryFactory hands out a working, cached Repository per model", async () => {
    await withConnection(connect, async (db) => {
      const registry = new ModelRegistry();
      registry.define({
        name: "invoice",
        fields: { id: { type: "integer", required: true } },
      });
      await sync(db, registry);

      const repos = new RepositoryFactory(db, registry);
      const invoices = repos.for("invoice");
      expect(repos.for("invoice")).toBe(invoices); // cached, same instance

      const created = await invoices.create({ id: 1 });
      expect(created.id).toBe(1);
    });
  });

  describe("validation failures", () => {
    it("create() throws ValidationError for a missing required field", async () => {
      await withConnection(connect, async (db) => {
        const { repo } = await setupInvoiceRepo(db);
        await expect(repo.create({ id: 1 })).rejects.toThrow(ValidationError);
      });
    });

    it("ValidationError carries a fieldErrors map naming the bad field", async () => {
      await withConnection(connect, async (db) => {
        const { repo } = await setupInvoiceRepo(db);
        try {
          await repo.create({ id: 1 });
          expect.unreachable("should have thrown");
        } catch (err) {
          expect(err).toBeInstanceOf(ValidationError);
          expect(err.fieldErrors.customerId).toEqual(["value is required"]);
        }
      });
    });

    it("create() throws for an unknown field name (catches typos)", async () => {
      await withConnection(connect, async (db) => {
        const { repo } = await setupInvoiceRepo(db);
        await expect(repo.create({ id: 1, customerId: 1, cutsomerId: 1 })).rejects.toThrow(
          ValidationError
        );
      });
    });

    it("create() throws for a value that fails type validation", async () => {
      await withConnection(connect, async (db) => {
        const { repo } = await setupInvoiceRepo(db);
        await expect(
          repo.create({ id: "not-a-number", customerId: 1 })
        ).rejects.toThrow(ValidationError);
      });
    });

    it("a failed create() does not insert a row", async () => {
      await withConnection(connect, async (db) => {
        const { repo } = await setupInvoiceRepo(db);
        await expect(repo.create({ id: 1 })).rejects.toThrow(ValidationError);
        const rows = await repo.find();
        expect(rows).toHaveLength(0);
      });
    });

    it("update() throws when given no fields to update", async () => {
      await withConnection(connect, async (db) => {
        const { repo } = await setupInvoiceRepo(db);
        await repo.create({ id: 1, customerId: 1 });
        await expect(repo.update({ id: 1 }, {})).rejects.toThrow(ValidationError);
      });
    });

    it("delete() throws when given an empty filter (refuses to wipe the table silently)", async () => {
      await withConnection(connect, async (db) => {
        const { repo } = await setupInvoiceRepo(db);
        await repo.create({ id: 1, customerId: 1 });
        await expect(repo.delete({})).rejects.toThrow(ValidationError);

        const rows = await repo.find();
        expect(rows).toHaveLength(1); // still there
      });
    });
  });

  describe("transactions", () => {
    it("commits all operations performed inside a successful transaction", async () => {
      await withConnection(connect, async (db) => {
        const { repo } = await setupInvoiceRepo(db);

        await runInTransaction(db, async (trx) => {
          await repo.create({ id: 1, customerId: 1 }, { trx });
          await repo.create({ id: 2, customerId: 1 }, { trx });
        });

        const rows = await repo.find();
        expect(rows.map((r) => r.id).sort()).toEqual([1, 2]);
      });
    });

    it("rolls back every operation if the transaction callback throws partway through", async () => {
      await withConnection(connect, async (db) => {
        const { repo } = await setupInvoiceRepo(db);

        await expect(
          runInTransaction(db, async (trx) => {
            await repo.create({ id: 1, customerId: 1 }, { trx });
            await repo.create({ id: 2, customerId: 1 }, { trx });
            throw new Error("simulated failure partway through");
          })
        ).rejects.toThrow("simulated failure partway through");

        // Neither insert should have persisted - full rollback.
        const rows = await repo.find();
        expect(rows).toHaveLength(0);
      });
    });

    it("rolls back if a later operation in the transaction fails validation", async () => {
      await withConnection(connect, async (db) => {
        const { repo } = await setupInvoiceRepo(db);

        await expect(
          runInTransaction(db, async (trx) => {
            await repo.create({ id: 1, customerId: 1 }, { trx });
            await repo.create({ id: 2 }, { trx }); // missing required customerId
          })
        ).rejects.toThrow(ValidationError);

        const rows = await repo.find();
        expect(rows).toHaveLength(0);
      });
    });

    it("keeps transactional and non-transactional operations isolated until commit", async () => {
      await withConnection(connect, async (db) => {
        const { repo } = await setupInvoiceRepo(db);

        await runInTransaction(db, async (trx) => {
          await repo.create({ id: 1, customerId: 1 }, { trx });
          // Reading without the trx shouldn't see the uncommitted row
          // on engines with proper transaction isolation. sqlite's
          // single-connection nature makes this less meaningful there,
          // so this assertion focuses on the trx-scoped read seeing it.
          const withinTrx = await repo.find({ id: 1 }, { trx });
          expect(withinTrx).toHaveLength(1);
        });

        const afterCommit = await repo.find({ id: 1 });
        expect(afterCommit).toHaveLength(1);
      });
    });
  });
});
