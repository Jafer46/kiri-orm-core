import { describe, it, expect } from "vitest";
import { eachDialect, withConnection } from "../helpers/dialects.js";
import { ModelRegistry } from "../../src/models/registry.js";
import { sync } from "../../src/schema/sync.js";
import { RepositoryFactory } from "../../src/crud/repository-factory.js";

function buildOrderingRegistry() {
  const registry = new ModelRegistry();
  registry.define({
    name: "customer",
    fields: { id: { type: "integer", required: true }, name: { type: "char", required: true } },
  });
  registry.define({
    name: "order",
    fields: {
      id: { type: "integer", required: true },
      customerId: { type: "integer", required: true },
      status: { type: "enum", values: ["pending", "paid"], default: "pending" },
    },
    relations: {
      customer: { type: "belongsTo", model: "customer", foreignKey: "customerId" },
      items: { type: "hasMany", model: "orderItem", foreignKey: "orderId" },
      tags: {
        type: "belongsToMany",
        model: "tag",
        through: "order_tag",
        foreignKey: "order_id",
        otherKey: "tag_id",
      },
    },
  });
  registry.define({
    name: "orderItem",
    fields: {
      id: { type: "integer", required: true },
      orderId: { type: "integer", required: true },
      productId: { type: "integer", required: true },
    },
    relations: {
      product: { type: "belongsTo", model: "product", foreignKey: "productId" },
    },
  });
  registry.define({
    name: "product",
    fields: { id: { type: "integer", required: true }, name: { type: "char", required: true } },
  });
  registry.define({
    name: "tag",
    fields: { id: { type: "integer", required: true }, name: { type: "char", required: true } },
  });
  return registry;
}

describe.each(eachDialect())("domain relation traversal - %s", ({ name, connect }) => {
  it("belongsTo traversal: finds orders belonging to a customer matched by name", async () => {
    await withConnection(connect, async (db) => {
      const registry = buildOrderingRegistry();
      await sync(db, registry);
      const repos = new RepositoryFactory(db, registry);

      await repos.for("customer").create({ id: 1, name: "Acme" });
      await repos.for("customer").create({ id: 2, name: "Beta" });
      await repos.for("order").create({ id: 1, customerId: 1 });
      await repos.for("order").create({ id: 2, customerId: 2 });

      const orders = await repos.for("order").find([["customer.name", "=", "Acme"]]);
      expect(orders.map((o) => o.id)).toEqual([1]);
    });
  });

  it("hasMany traversal: finds orders that have an item for a specific product", async () => {
    await withConnection(connect, async (db) => {
      const registry = buildOrderingRegistry();
      await sync(db, registry);
      const repos = new RepositoryFactory(db, registry);

      await repos.for("customer").create({ id: 1, name: "Acme" });
      await repos.for("product").createMany([{ id: 100, name: "Widget" }, { id: 200, name: "Gadget" }]);
      await repos.for("order").create({ id: 1, customerId: 1 });
      await repos.for("order").create({ id: 2, customerId: 1 });
      await repos.for("orderItem").create({ id: 1, orderId: 1, productId: 100 });
      await repos.for("orderItem").create({ id: 2, orderId: 2, productId: 200 });

      const orders = await repos.for("order").find([["items.productId", "=", 100]]);
      expect(orders.map((o) => o.id)).toEqual([1]);
    });
  });

  it("belongsToMany traversal: finds orders tagged with a specific tag", async () => {
    await withConnection(connect, async (db) => {
      const registry = buildOrderingRegistry();
      await sync(db, registry);
      const repos = new RepositoryFactory(db, registry);

      await repos.for("customer").create({ id: 1, name: "Acme" });
      await repos.for("order").create({ id: 1, customerId: 1 });
      await repos.for("order").create({ id: 2, customerId: 1 });
      await repos.for("tag").create({ id: 1, name: "urgent" });
      await db("order_tag").insert({ order_id: 1, tag_id: 1 });

      const orders = await repos.for("order").find([["tags.name", "=", "urgent"]]);
      expect(orders.map((o) => o.id)).toEqual([1]);
    });
  });

  it("nested traversal (order.items.product.name) finds the right rows", async () => {
    await withConnection(connect, async (db) => {
      const registry = buildOrderingRegistry();
      await sync(db, registry);
      const repos = new RepositoryFactory(db, registry);

      await repos.for("customer").create({ id: 1, name: "Acme" });
      await repos.for("product").create({ id: 1, name: "Widget" });
      await repos.for("product").create({ id: 2, name: "Gadget" });
      await repos.for("order").create({ id: 1, customerId: 1 });
      await repos.for("order").create({ id: 2, customerId: 1 });
      await repos.for("orderItem").create({ id: 1, orderId: 1, productId: 1 });
      await repos.for("orderItem").create({ id: 2, orderId: 2, productId: 2 });

      const orders = await repos.for("order").find([["items.product.name", "=", "Widget"]]);
      expect(orders.map((o) => o.id)).toEqual([1]);
    });
  });

  it("relation traversal combines with a plain field condition via implicit AND", async () => {
    await withConnection(connect, async (db) => {
      const registry = buildOrderingRegistry();
      await sync(db, registry);
      const repos = new RepositoryFactory(db, registry);

      await repos.for("customer").create({ id: 1, name: "Acme" });
      await repos.for("order").create({ id: 1, customerId: 1, status: "paid" });
      await repos.for("order").create({ id: 2, customerId: 1, status: "pending" });

      const orders = await repos.for("order").find([
        ["customer.name", "=", "Acme"],
        ["status", "=", "paid"],
      ]);
      expect(orders.map((o) => o.id)).toEqual([1]);
    });
  });

  it("relation traversal combines with OR", async () => {
    await withConnection(connect, async (db) => {
      const registry = buildOrderingRegistry();
      await sync(db, registry);
      const repos = new RepositoryFactory(db, registry);

      await repos.for("customer").create({ id: 1, name: "Acme" });
      await repos.for("customer").create({ id: 2, name: "Beta" });
      await repos.for("order").create({ id: 1, customerId: 1, status: "pending" });
      await repos.for("order").create({ id: 2, customerId: 2, status: "paid" });
      await repos.for("order").create({ id: 3, customerId: 2, status: "pending" });

      const orders = await repos.for("order").find(["|", ["customer.name", "=", "Acme"], ["status", "=", "paid"]]);
      expect(orders.map((o) => o.id).sort()).toEqual([1, 2]);
    });
  });
});
