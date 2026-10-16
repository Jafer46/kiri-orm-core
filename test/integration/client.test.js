import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eachDialect, createIsolatedPgSchema } from "../helpers/dialects.js";
import { createClient } from "../../src/client/create-client.js";
import { defineModule } from "../../src/client/module.js";
import { UnknownModelError } from "../../src/models/errors.js";
import { RelationError } from "../../src/relations/errors.js";

// On Postgres every test gets its own schema (see createIsolatedPgSchema), created in
// beforeEach and dropped in afterEach; connectionConfigFor() hands out its connection.
let isolatedSchema = null;

function connectionConfigFor(dialectName) {
  return dialectName === "postgres"
    ? { dialect: "postgres", connectionString: isolatedSchema.connectionString }
    : { dialect: "sqlite", filename: ":memory:" };
}

function invoicingModels() {
  return [
    {
      name: "customer",
      fields: { id: { type: "integer", required: true }, name: { type: "char", required: true } },
    },
    {
      name: "invoice",
      fields: {
        id: { type: "integer", required: true },
        customerId: { type: "integer", required: true },
        status: { type: "enum", values: ["draft", "paid"], default: "draft" },
      },
      relations: {
        customer: { type: "belongsTo", model: "customer", foreignKey: "customerId" },
        tags: {
          type: "belongsToMany",
          model: "tag",
          through: "invoice_tag",
          foreignKey: "invoice_id",
          otherKey: "tag_id",
        },
      },
    },
    { name: "tag", fields: { id: { type: "integer", required: true }, name: { type: "char", required: true } } },
  ];
}

describe.each(eachDialect())("OrmClient - %s", ({ name }) => {
  beforeEach(async () => {
    if (name === "postgres") isolatedSchema = await createIsolatedPgSchema();
  });
  afterEach(async () => {
    if (isolatedSchema) await isolatedSchema.drop();
    isolatedSchema = null;
  });

  it("syncs and exposes a working models proxy", async () => {
    const client = createClient(connectionConfigFor(name), { models: invoicingModels() });
    await client.sync();

    const customer = await client.models.customer.create({ id: 1, name: "Acme" });
    expect(customer.id).toBe(1);

    await client.close();
  });

  it("throws immediately (not on first method call) for an unregistered model name", async () => {
    const client = createClient(connectionConfigFor(name), { models: invoicingModels() });
    await client.sync();

    expect(() => client.models.nonexistent).toThrow(UnknownModelError);

    await client.close();
  });

  it("find/findOne/create return tracked entities with working save()/delete()", async () => {
    const client = createClient(connectionConfigFor(name), { models: invoicingModels() });
    await client.sync();

    await client.models.customer.create({ id: 1, name: "Acme" });
    const invoice = await client.models.invoice.create({ id: 1, customerId: 1 });
    expect(typeof invoice.save).toBe("function");
    expect(typeof invoice.delete).toBe("function");

    invoice.status = "paid";
    await invoice.save();

    const [found] = await client.models.invoice.find({ id: 1 });
    expect(found.status).toBe("paid");
    expect(found).toBe(invoice); // identity map still applies through the client

    await client.close();
  });

  it("eager loading via `with` works the same as it does on Repository", async () => {
    const client = createClient(connectionConfigFor(name), { models: invoicingModels() });
    await client.sync();

    await client.models.customer.create({ id: 1, name: "Acme" });
    await client.models.invoice.create({ id: 1, customerId: 1 });

    const [invoice] = await client.models.invoice.find({ id: 1 }, { with: ["customer"] });
    expect(invoice.customer.name).toBe("Acme");

    await client.close();
  });

  it("attach() associates records via a belongsToMany relation and doesn't duplicate on repeat calls", async () => {
    const client = createClient(connectionConfigFor(name), { models: invoicingModels() });
    await client.sync();

    await client.models.customer.create({ id: 1, name: "Acme" });
    const invoice = await client.models.invoice.create({ id: 1, customerId: 1 });
    await client.models.tag.create({ id: 1, name: "urgent" });
    await client.models.tag.create({ id: 2, name: "overdue" });

    const firstAttachCount = await client.models.invoice.attach(invoice, "tags", [1, 2]);
    expect(firstAttachCount).toBe(2);

    const secondAttachCount = await client.models.invoice.attach(invoice, "tags", [1, 2]);
    expect(secondAttachCount).toBe(0); // already attached, not duplicated

    const [reloaded] = await client.models.invoice.find({ id: 1 }, { with: ["tags"] });
    expect(reloaded.tags.map((t) => t.name).sort()).toEqual(["overdue", "urgent"]);

    await client.close();
  });

  it("detach() removes associations", async () => {
    const client = createClient(connectionConfigFor(name), { models: invoicingModels() });
    await client.sync();

    await client.models.customer.create({ id: 1, name: "Acme" });
    const invoice = await client.models.invoice.create({ id: 1, customerId: 1 });
    await client.models.tag.create({ id: 1, name: "urgent" });
    await client.models.invoice.attach(invoice, "tags", 1);

    const removedCount = await client.models.invoice.detach(invoice, "tags", 1);
    expect(removedCount).toBe(1);

    const [reloaded] = await client.models.invoice.find({ id: 1 }, { with: ["tags"] });
    expect(reloaded.tags).toEqual([]);

    await client.close();
  });

  it("attach()/detach() reject a relation that isn't belongsToMany", async () => {
    const client = createClient(connectionConfigFor(name), { models: invoicingModels() });
    await client.sync();
    await client.models.customer.create({ id: 1, name: "Acme" });
    const invoice = await client.models.invoice.create({ id: 1, customerId: 1 });

    await expect(client.models.invoice.attach(invoice, "customer", 1)).rejects.toThrow(RelationError);

    await client.close();
  });

  it("updateMany() bulk-updates without going through the identity map", async () => {
    const client = createClient(connectionConfigFor(name), { models: invoicingModels() });
    await client.sync();
    await client.models.customer.create({ id: 1, name: "Acme" });
    await client.models.invoice.create({ id: 1, customerId: 1, status: "draft" });
    await client.models.invoice.create({ id: 2, customerId: 1, status: "draft" });

    const affected = await client.models.invoice.updateMany({ status: "draft" }, { status: "paid" });
    expect(affected).toBe(2);

    await client.close();
  });

  it("deleteMany() bulk-deletes", async () => {
    const client = createClient(connectionConfigFor(name), { models: invoicingModels() });
    await client.sync();
    await client.models.customer.create({ id: 1, name: "Acme" });
    await client.models.invoice.create({ id: 1, customerId: 1 });

    const affected = await client.models.invoice.deleteMany({ id: 1 });
    expect(affected).toBe(1);
    expect(await client.models.invoice.find()).toEqual([]);

    await client.close();
  });

  it("client.db is a working escape hatch to the raw Knex instance", async () => {
    const client = createClient(connectionConfigFor(name), { models: invoicingModels() });
    await client.sync();
    await client.models.customer.create({ id: 1, name: "Acme" });

    const rawRow = await client.db("customer").where({ id: 1 }).first();
    expect(rawRow.name).toBe("Acme");

    await client.close();
  });

  describe("transactions", () => {
    it("commits everything performed inside on success, via the same client.models surface", async () => {
      const client = createClient(connectionConfigFor(name), { models: invoicingModels() });
      await client.sync();

      await client.transaction(async (tx) => {
        await tx.models.customer.create({ id: 1, name: "Acme" });
        await tx.models.invoice.create({ id: 1, customerId: 1 });
      });

      const invoices = await client.models.invoice.find();
      expect(invoices).toHaveLength(1);

      await client.close();
    });

    it("rolls back everything if the callback throws", async () => {
      const client = createClient(connectionConfigFor(name), { models: invoicingModels() });
      await client.sync();

      await expect(
        client.transaction(async (tx) => {
          await tx.models.customer.create({ id: 1, name: "Acme" });
          throw new Error("boom");
        })
      ).rejects.toThrow("boom");

      expect(await client.models.customer.find()).toEqual([]);

      await client.close();
    });

    it("a transaction-scoped client has its own identity map, separate from the parent", async () => {
      const client = createClient(connectionConfigFor(name), { models: invoicingModels() });
      await client.sync();
      await client.models.customer.create({ id: 1, name: "Acme" });

      // Load into the parent's identity map BEFORE opening the
      // transaction - concurrently reading via the parent's `db`
      // while a transaction is open on that same connection is
      // unsafe for single-connection SQLite (it can deadlock), so
      // the two reads are kept sequential rather than overlapping.
      const [fromParent] = await client.models.customer.find({ id: 1 });

      await client.transaction(async (tx) => {
        const [fromTx] = await tx.models.customer.find({ id: 1 });
        expect(fromTx).not.toBe(fromParent);
      });

      await client.close();
    });
  });

  describe("module composition", () => {
    it("aggregates models from multiple modules and runs each module's hooks", async () => {
      const identityModule = defineModule({
        name: "identity",
        models: [
          { name: "customer", fields: { id: { type: "integer", required: true }, name: { type: "char", required: true } } },
        ],
      });

      const billingModule = defineModule({
        name: "billing",
        models: [
          {
            name: "invoice",
            fields: {
              id: { type: "integer", required: true },
              customerId: { type: "integer", required: true },
              status: { type: "enum", values: ["draft", "paid"], default: "draft" },
              paidAt: { type: "datetime" },
            },
            relations: {
              customer: { type: "belongsTo", model: "customer", foreignKey: "customerId" },
            },
          },
        ],
        registerHooks: (hooks) => {
          hooks.on("invoice", "beforeCreate", (data) => {
            if (data.status === "paid" && !data.paidAt) data.paidAt = new Date();
          });
        },
      });

      const client = createClient(connectionConfigFor(name), { modules: [identityModule, billingModule] });
      await client.sync();

      await client.models.customer.create({ id: 1, name: "Acme" });
      const invoice = await client.models.invoice.create({ id: 1, customerId: 1, status: "paid" });

      expect(invoice.paidAt).toBeInstanceOf(Date); // billing module's hook fired

      const [withCustomer] = await client.models.invoice.find({ id: 1 }, { with: ["customer"] });
      expect(withCustomer.customer.name).toBe("Acme"); // cross-module relation resolves fine

      await client.close();
    });

    it("exposes a module's createService result as client.<moduleName>, with real domain operations, not just CRUD", async () => {
      const identityModule = defineModule({
        name: "identity",
        models: [
          { name: "customer", fields: { id: { type: "integer", required: true }, name: { type: "char", required: true } } },
        ],
        createService: (client) => ({
          async register({ id, name }) {
            return client.models.customer.create({ id, name });
          },
        }),
      });

      const client = createClient(connectionConfigFor(name), { modules: [identityModule] });
      await client.sync();

      expect(typeof client.identity.register).toBe("function");
      const customer = await client.identity.register({ id: 1, name: "Acme" });
      expect(customer.name).toBe("Acme");

      await client.close();
    });

    it("a module's service can call ANOTHER module's service, never that module's raw models directly", async () => {
      const identityModule = defineModule({
        name: "identity",
        models: [
          { name: "customer", fields: { id: { type: "integer", required: true }, name: { type: "char", required: true } } },
        ],
        createService: (client) => ({
          register: ({ id, name }) => client.models.customer.create({ id, name }),
        }),
      });

      const ordersModule = defineModule({
        name: "orders",
        models: [
          {
            name: "order",
            fields: { id: { type: "integer", required: true }, customerId: { type: "integer", required: true } },
          },
        ],
        createService: (client) => ({
          // Calls identity's SERVICE, not client.models.customer directly.
          async placeOrderForNewCustomer({ orderId, customerId, customerName }) {
            const customer = await client.identity.register({ id: customerId, name: customerName });
            const order = await client.models.order.create({ id: orderId, customerId: customer.id });
            return { customer, order };
          },
        }),
      });

      const client = createClient(connectionConfigFor(name), { modules: [identityModule, ordersModule] });
      await client.sync();

      const { customer, order } = await client.orders.placeOrderForNewCustomer({
        orderId: 1,
        customerId: 1,
        customerName: "Acme",
      });
      expect(customer.name).toBe("Acme");
      expect(order.customerId).toBe(1);

      await client.close();
    });

    it("module services are rebuilt for a transaction-scoped client, so tx.<moduleName> works inside a transaction", async () => {
      const identityModule = defineModule({
        name: "identity",
        models: [
          { name: "customer", fields: { id: { type: "integer", required: true }, name: { type: "char", required: true } } },
        ],
        createService: (client) => ({
          register: ({ id, name }) => client.models.customer.create({ id, name }),
        }),
      });

      const client = createClient(connectionConfigFor(name), { modules: [identityModule] });
      await client.sync();

      await client.transaction(async (tx) => {
        expect(typeof tx.identity.register).toBe("function");
        await tx.identity.register({ id: 1, name: "Acme" });
      });

      const customers = await client.models.customer.find();
      expect(customers).toHaveLength(1);

      await client.close();
    });

    it("rejects a module whose name collides with a built-in client property", async () => {
      const badModule = defineModule({
        name: "models", // collides with client.models
        models: [{ name: "widget", fields: { id: { type: "integer", required: true } } }],
        createService: () => ({}),
      });

      expect(() => createClient(connectionConfigFor(name), { modules: [badModule] })).toThrow(TypeError);
    });
  });
});
