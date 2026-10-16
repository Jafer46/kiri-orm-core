import { ModelRegistry } from "../../src/models/registry.js";
import { toRow } from "../../src/crud/row-mapping.js";

/**
 * Orders for the aggregate tests.
 *
 *   order --belongsTo--> customer      order --hasMany--> item
 *
 * `shippingFee` exists for one reason: its column is `shipping_fee`, so an aggregate named
 * `shipping_fee` collides with a column name (see the ORDER BY test). `label` is a computed
 * field, which can be neither grouped by nor aggregated.
 */
export const AGG_MODELS = [
  { name: "company", fields: { id: { type: "integer", required: true }, name: { type: "char" }, country: { type: "char" } } },
  { name: "product", fields: { id: { type: "integer", required: true }, name: { type: "char" }, category: { type: "char" }, price: { type: "float" } } },
  { name: "tag", fields: { id: { type: "integer", required: true }, name: { type: "char" } } },
  {
    name: "customer",
    fields: {
      id: { type: "integer", required: true },
      name: { type: "char", required: true },
      country: { type: "char" },
      vip: { type: "boolean", default: false },
      credit: { type: "float" },
      createdAt: { type: "datetime" },
      companyId: { type: "integer" },
    },
    relations: {
      company: { type: "belongsTo", model: "company", foreignKey: "companyId" },
      orders: { type: "hasMany", model: "order", foreignKey: "customerId" },
    },
  },
  {
    name: "item",
    fields: {
      id: { type: "integer", required: true },
      orderId: { type: "integer", required: true },
      productId: { type: "integer" },
      sku: { type: "char", required: true },
      qty: { type: "integer", default: 1 },
      amount: { type: "float", default: 0 },
    },
    relations: {
      product: { type: "belongsTo", model: "product", foreignKey: "productId" },
      order: { type: "belongsTo", model: "order", foreignKey: "orderId" },
    },
  },
  {
    name: "order",
    fields: {
      id: { type: "integer", required: true },
      customerId: { type: "integer" },
      status: { type: "char", required: true },
      total: { type: "float", required: true },
      qty: { type: "integer", default: 1 },
      shippingFee: { type: "integer", default: 0 },
      placedAt: { type: "datetime" },
      shippedOn: { type: "date" },
      note: { type: "char" },
      meta: { type: "json" },
      label: { type: "char", depends: ["status", "id"], compute: (r) => `${r.status}#${r.id}` },
    },
    relations: {
      customer: { type: "belongsTo", model: "customer", foreignKey: "customerId" },
      items: { type: "hasMany", model: "item", foreignKey: "orderId" },
      firstItem: { type: "hasOne", model: "item", foreignKey: "orderId" },
      tags: { type: "belongsToMany", model: "tag", through: "order_tag", foreignKey: "order_id", otherKey: "tag_id" },
    },
  },
];

const columns = new ModelRegistry();
for (const model of AGG_MODELS) columns.define(model);

/** Inserts rows written with field names (so ids are explicit), converting to column names. */
export async function insertAgg(db, modelName, rows) {
  const model = columns.getModel(modelName);
  await db(model.tableName).insert(rows.map((row) => toRow(model, row)));
}

const at = (iso) => new Date(iso);

/**
 * The dataset every expected number in the tests is computed from. Written out in full so the
 * arithmetic can be checked by eye:
 *
 *  id cust status    total qty fee placedAt (UTC)           shippedOn   note
 *   1  1   paid       100   2   2  2024-01-31T23:30:00Z    2024-02-02  a
 *   2  1   paid        50   1   2  2024-02-01T00:10:00Z    -           -
 *   3  2   paid       200   4   1  2024-02-14T12:00:00Z    2024-02-15  c
 *   4  3   cancelled   75   3   3  2024-05-05T05:05:05Z    -           d     (a Sunday)
 *   5  -   paid        10   1   3  -                       -           e
 *   6  3   paid       300   6   1  2024-05-20T10:00:00Z    2024-05-21  -
 *   7  2   refunded    20   1   2  2024-02-20T08:00:00Z    -           g
 *
 * Totals: 7 orders, sum(total) 755, sum(qty) 18.
 *
 * Related data (Phase 16). Item amounts add up to the order's total wherever an order has items, so a
 * wrong join shows up immediately as a wrong total:
 *
 *  item order sku   product(price)  qty amount          customer  country company(country)  credit createdAt
 *   1     1   skuA   1 Hammer(10)    1    40             1 Ada     UK      1 Acme(UK)         100    2023-12-15
 *   2     1   skuB   2 Saw(25)       1    60             2 Alan    UK      1 Acme(UK)          50    2024-01-10
 *   3     2   skuA   1 Hammer(10)    1    50             3 Grace   US      2 Globex(US)        25    2024-01-20
 *   4     3   skuA   1 Hammer(10)    2    80
 *   5     3   skuB   2 Saw(25)       2   120             tags (order_tag): order 1 -> alpha, beta;
 *   6     6   skuC   3 Robot(40)     6   300                               order 2 -> alpha; order 3 -> beta
 *
 * Orders 4, 5 and 7 have no items and no tags; order 5 has no customer.
 */
export async function seedAgg(db) {
  await insertAgg(db, "company", [{ id: 1, name: "Acme", country: "UK" }, { id: 2, name: "Globex", country: "US" }]);
  await insertAgg(db, "product", [
    { id: 1, name: "Hammer", category: "tools", price: 10 },
    { id: 2, name: "Saw", category: "tools", price: 25 },
    { id: 3, name: "Robot", category: "toys", price: 40 },
  ]);
  await insertAgg(db, "tag", [{ id: 1, name: "alpha" }, { id: 2, name: "beta" }]);
  await insertAgg(db, "customer", [
    { id: 1, name: "Ada", country: "UK", vip: true, credit: 100, createdAt: at("2023-12-15T10:00:00Z"), companyId: 1 },
    { id: 2, name: "Alan", country: "UK", vip: false, credit: 50, createdAt: at("2024-01-10T10:00:00Z"), companyId: 1 },
    { id: 3, name: "Grace", country: "US", vip: true, credit: 25, createdAt: at("2024-01-20T10:00:00Z"), companyId: 2 },
  ]);
  await insertAgg(db, "order", [
    { id: 1, customerId: 1, status: "paid", total: 100, qty: 2, shippingFee: 2, placedAt: at("2024-01-31T23:30:00Z"), shippedOn: at("2024-02-02T00:00:00Z"), note: "a" },
    { id: 2, customerId: 1, status: "paid", total: 50, qty: 1, shippingFee: 2, placedAt: at("2024-02-01T00:10:00Z"), note: null },
    { id: 3, customerId: 2, status: "paid", total: 200, qty: 4, shippingFee: 1, placedAt: at("2024-02-14T12:00:00Z"), shippedOn: at("2024-02-15T00:00:00Z"), note: "c" },
    { id: 4, customerId: 3, status: "cancelled", total: 75, qty: 3, shippingFee: 3, placedAt: at("2024-05-05T05:05:05Z"), note: "d" },
    { id: 5, customerId: null, status: "paid", total: 10, qty: 1, shippingFee: 3, placedAt: null, note: "e" },
    { id: 6, customerId: 3, status: "paid", total: 300, qty: 6, shippingFee: 1, placedAt: at("2024-05-20T10:00:00Z"), shippedOn: at("2024-05-21T00:00:00Z"), note: null },
    { id: 7, customerId: 2, status: "refunded", total: 20, qty: 1, shippingFee: 2, placedAt: at("2024-02-20T08:00:00Z"), note: "g" },
  ]);
  await insertAgg(db, "item", [
    { id: 1, orderId: 1, productId: 1, sku: "skuA", qty: 1, amount: 40 },
    { id: 2, orderId: 1, productId: 2, sku: "skuB", qty: 1, amount: 60 },
    { id: 3, orderId: 2, productId: 1, sku: "skuA", qty: 1, amount: 50 },
    { id: 4, orderId: 3, productId: 1, sku: "skuA", qty: 2, amount: 80 },
    { id: 5, orderId: 3, productId: 2, sku: "skuB", qty: 2, amount: 120 },
    { id: 6, orderId: 6, productId: 3, sku: "skuC", qty: 6, amount: 300 },
  ]);
  await db("order_tag").insert([{ order_id: 1, tag_id: 1 }, { order_id: 1, tag_id: 2 }, { order_id: 2, tag_id: 1 }, { order_id: 3, tag_id: 2 }]);
}

/** `n` extra orders (ids from 1000) for the "statement count doesn't grow" test. */
export async function seedManyOrders(db, n) {
  const rows = Array.from({ length: n }, (_, i) => ({
    id: 1000 + i, customerId: (i % 3) + 1, status: i % 2 ? "paid" : "cancelled", total: i + 1, qty: 1, shippingFee: 0,
    placedAt: new Date(Date.UTC(2024, i % 12, 1 + (i % 28))),
  }));
  for (let i = 0; i < rows.length; i += 50) await insertAgg(db, "order", rows.slice(i, i + 50));
}
