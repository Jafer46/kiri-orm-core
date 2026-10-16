import { describe, it, expect } from "vitest";
import { sqliteConnection } from "../../helpers/dialects.js";
import { ModelRegistry } from "../../../src/models/registry.js";
import { compileDomain } from "../../../src/domain/compile.js";
import { DomainValidationError } from "../../../src/domain/errors.js";

function buildRegistry() {
  const registry = new ModelRegistry();
  registry.define({
    name: "customer",
    fields: { id: { type: "integer", required: true }, name: { type: "char" } },
  });
  registry.define({
    name: "order",
    fields: { id: { type: "integer", required: true }, customerId: { type: "integer" } },
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
    fields: { id: { type: "integer", required: true }, orderId: { type: "integer" }, productId: { type: "integer" } },
    relations: {
      product: { type: "belongsTo", model: "product", foreignKey: "productId" },
    },
  });
  registry.define({
    name: "product",
    fields: { id: { type: "integer", required: true }, name: { type: "char" } },
  });
  registry.define({
    name: "tag",
    fields: { id: { type: "integer", required: true }, name: { type: "char" } },
  });
  return registry;
}

function sql(registry, modelName, domain) {
  const db = sqliteConnection();
  const model = registry.getModel(modelName);
  const str = db(model.tableName).where(compileDomain(model, domain, undefined, registry)).toString();
  db.destroy();
  return str;
}

describe("compileDomain - relation traversal (verified snapshots)", () => {
  it("belongsTo: compiles to a single-level subquery on the related table", () => {
    const registry = buildRegistry();
    expect(sql(registry, "order", [["customer.name", "=", "Acme"]])).toBe(
      "select * from `order` where (`customer_id` in (select `id` from `customer` where (`name` = 'Acme')))"
    );
  });

  it("hasMany: compiles to a subquery matching the related table's foreign key", () => {
    const registry = buildRegistry();
    expect(sql(registry, "order", [["items.productId", "=", 5]])).toBe(
      "select * from `order` where (`id` in (select `order_id` from `order_item` where (`product_id` = 5)))"
    );
  });

  it("belongsToMany: compiles to two nested subqueries (pivot, then related)", () => {
    const registry = buildRegistry();
    expect(sql(registry, "order", [["tags.name", "=", "urgent"]])).toBe(
      "select * from `order` where (`id` in (select `order_id` from `order_tag` where `tag_id` in (select `id` from `tag` where (`name` = 'urgent'))))"
    );
  });

  it("supports arbitrary depth: order -> items -> product", () => {
    const registry = buildRegistry();
    expect(sql(registry, "order", [["items.product.name", "=", "Widget"]])).toBe(
      "select * from `order` where (`id` in (select `order_id` from `order_item` where (`product_id` in (select `id` from `product` where (`name` = 'Widget')))))"
    );
  });

  it("relation traversal composes normally inside AND/OR groups", () => {
    const registry = buildRegistry();
    const str = sql(registry, "order", [
      "|",
      ["customer.name", "=", "Acme"],
      ["tags.name", "=", "urgent"],
    ]);
    expect(str).toContain("customer_id` in");
    expect(str).toContain("or");
    expect(str).toContain("order_tag");
  });
});

describe("compileDomain - relation traversal validation", () => {
  it("throws a specific, actionable error when a relation name is used as a plain field (the most likely real mistake)", () => {
    // Regression test for confusing error output a user actually hit:
    // ["tags", "in", [...]] on a model with a "tags" belongsToMany
    // relation used to just say "unknown field" with no hint that
    // "tags" IS a real relation and needs a dotted field path.
    const registry = buildRegistry();
    const model = registry.getModel("order");
    expect(() => compileDomain(model, [["tags", "=", "x"]], undefined, registry)).toThrow(
      /"tags" is a relation on model "order", not a field.*"tags\.id"/s
    );
  });

  it("throws DomainValidationError for an unknown relation name", () => {
    const registry = buildRegistry();
    const model = registry.getModel("order");
    expect(() => compileDomain(model, [["bogusRelation.name", "=", "x"]], undefined, registry)).toThrow(
      DomainValidationError
    );
  });

  it("throws DomainValidationError when a relation is named with no field after it", () => {
    const registry = buildRegistry();
    const model = registry.getModel("order");
    expect(() => compileDomain(model, [["customer.", "=", "x"]], undefined, registry)).toThrow(
      DomainValidationError
    );
  });

  it("throws DomainValidationError when modelRegistry is omitted but the domain traverses a relation", () => {
    const registry = buildRegistry();
    const model = registry.getModel("order");
    expect(() => compileDomain(model, [["customer.name", "=", "x"]])).toThrow(DomainValidationError);
  });

  it("still throws for a genuinely unknown field on the related model", () => {
    const registry = buildRegistry();
    const model = registry.getModel("order");
    expect(() => compileDomain(model, [["customer.typoField", "=", "x"]], undefined, registry)).toThrow(
      DomainValidationError
    );
  });
});
