import { describe, it, expect } from "vitest";
import { eachDialect, withConnection } from "../helpers/dialects.js";
import { countQueries } from "../helpers/query-counter.js";
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
    fields: { id: { type: "integer", required: true }, customerId: { type: "integer", required: true } },
    relations: {
      customer: { type: "belongsTo", model: "customer", foreignKey: "customerId" },
      items: { type: "hasMany", model: "orderItem", foreignKey: "orderId" },
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
    relations: {
      tags: {
        type: "belongsToMany",
        model: "tag",
        through: "product_tag",
        foreignKey: "product_id",
        otherKey: "tag_id",
      },
    },
  });
  registry.define({
    name: "tag",
    fields: { id: { type: "integer", required: true }, name: { type: "char", required: true } },
  });
  return registry;
}

describe.each(eachDialect())("nested eager loading - %s", ({ name, connect }) => {
  it("resolves a two-level path (order.items.product) with correct data", async () => {
    await withConnection(connect, async (db) => {
      const registry = buildOrderingRegistry();
      await sync(db, registry);
      const repos = new RepositoryFactory(db, registry);

      await repos.for("customer").create({ id: 1, name: "Acme" });
      await repos.for("product").create({ id: 1, name: "Widget" });
      await repos.for("product").create({ id: 2, name: "Gadget" });
      await repos.for("order").create({ id: 1, customerId: 1 });
      await repos.for("orderItem").create({ id: 1, orderId: 1, productId: 1 });
      await repos.for("orderItem").create({ id: 2, orderId: 1, productId: 2 });

      const [order] = await repos.for("order").find({ id: 1 }, { with: ["items.product"] });
      expect(order.items).toHaveLength(2);
      expect(order.items.map((i) => i.product.name).sort()).toEqual(["Gadget", "Widget"]);
    });
  });

  it("resolves a three-level path (order.items.product.tags)", async () => {
    await withConnection(connect, async (db) => {
      const registry = buildOrderingRegistry();
      await sync(db, registry);
      const repos = new RepositoryFactory(db, registry);

      await repos.for("customer").create({ id: 1, name: "Acme" });
      const widget = await repos.for("product").create({ id: 1, name: "Widget" });
      await repos.for("tag").create({ id: 1, name: "featured" });
      await db("product_tag").insert({ product_id: widget.id, tag_id: 1 });
      await repos.for("order").create({ id: 1, customerId: 1 });
      await repos.for("orderItem").create({ id: 1, orderId: 1, productId: widget.id });

      const [order] = await repos.for("order").find({ id: 1 }, { with: ["items.product.tags"] });
      expect(order.items[0].product.tags.map((t) => t.name)).toEqual(["featured"]);
    });
  });

  it("requesting both the parent path and the nested path together loads the parent only once", async () => {
    await withConnection(connect, async (db) => {
      const registry = buildOrderingRegistry();
      await sync(db, registry);
      const repos = new RepositoryFactory(db, registry);

      await repos.for("customer").create({ id: 1, name: "Acme" });
      await repos.for("product").create({ id: 1, name: "Widget" });
      await repos.for("order").create({ id: 1, customerId: 1 });
      await repos.for("orderItem").create({ id: 1, orderId: 1, productId: 1 });

      const { count } = await countQueries(db, () =>
        repos.for("order").find({ id: 1 }, { with: ["items", "items.product"] })
      );
      // base(order) + items + product = 3, not 4 (items loaded once, not twice)
      expect(count).toBe(3);
    });
  });

  it("stays N+1-safe at the nested level too: query count is constant regardless of row count", async () => {
    await withConnection(connect, async (db) => {
      const registry = buildOrderingRegistry();
      await sync(db, registry);
      const repos = new RepositoryFactory(db, registry);
      await repos.for("customer").create({ id: 1, name: "Acme" });
      await repos.for("order").create({ id: 1, customerId: 1 });

      await repos.for("product").create({ id: 1, name: "Widget" });
      await repos.for("orderItem").create({ id: 1, orderId: 1, productId: 1 });
      const { count: countWithOne } = await countQueries(db, () =>
        repos.for("order").find({ id: 1 }, { with: ["items.product"] })
      );

      for (let i = 2; i <= 6; i++) {
        await repos.for("product").create({ id: i, name: `Product ${i}` });
        await repos.for("orderItem").create({ id: i, orderId: 1, productId: i });
      }
      const { count: countWithSix } = await countQueries(db, () =>
        repos.for("order").find({ id: 1 }, { with: ["items.product"] })
      );

      expect(countWithOne).toBe(3); // order + items + product
      expect(countWithSix).toBe(3); // same, even with 6x the order items
    });
  });

  it("deduplicates nested loading when multiple parents share the same related record", async () => {
    await withConnection(connect, async (db) => {
      const registry = buildOrderingRegistry();
      await sync(db, registry);
      const repos = new RepositoryFactory(db, registry);

      await repos.for("customer").create({ id: 1, name: "Acme" });
      await repos.for("customer").create({ id: 2, name: "Beta" });
      await repos.for("order").create({ id: 1, customerId: 1 });
      await repos.for("order").create({ id: 2, customerId: 2 });

      // Both orders' first item points at the SAME product.
      await repos.for("product").create({ id: 1, name: "Widget" });
      await repos.for("orderItem").create({ id: 1, orderId: 1, productId: 1 });
      await repos.for("orderItem").create({ id: 2, orderId: 2, productId: 1 });

      const { count } = await countQueries(db, () =>
        repos.for("order").find({}, { with: ["items.product"] })
      );
      // order + items + product - still 3, even though 2 order items
      // both reference the same product (deduped before the nested query).
      expect(count).toBe(3);
    });
  });
});
