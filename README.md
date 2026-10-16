# kiri-orm

A JavaScript ORM for **SQLite and Postgres**, built on [Knex](https://knexjs.org).
Models are plain objects registered into your database at runtime: no code-generation
step, no schema file, nothing to build before your app starts.

```js
import { connect, createModel, syncModels } from "@kiri-orm/core";

connect({ dialect: "sqlite", filename: "./app.db" });

const Post = createModel("post", {
  fields: {
    id: { type: "integer", required: true },
    title: { type: "char", required: true, maxLength: 120 },
    published: { type: "boolean", default: false },
  },
});

await syncModels(); // creates the table
const post = await Post.create({ title: "Hello" });
```

## Why kiri-orm

- **A model is registered, not just declared.** `syncModels()` records every model and field in
  `_meta_models` / `_meta_fields` (an idea borrowed from Odoo). Migrations diff against that
  _recorded_ schema instead of guessing from live introspection, and the CLI and the DTO
  generators read from it too.
- **The database enforces your relations.** Every `belongsTo` becomes a real `FOREIGN KEY` with
  its `ON DELETE` action, so deleting a row is one statement however many tables point at it.
- **Relations load without N+1.** `with: [...]` costs one extra query per relation, however many
  rows come back.
- **Safe by default.** `syncModels()` only ever _creates_ tables and columns. It never drops or
  alters anything; destructive changes are explicit, reviewable migrations.

## Install

```bash
npm install @kiri-orm/core
```

Plus a driver for the database you use:

```bash
npm install better-sqlite3   # SQLite
npm install pg               # Postgres
```

The package is ES-modules only (`import`, not `require`).

## Quick start

**1. Connect, once, at startup.**

```js
// db.js
import { connect } from "@kiri-orm/core";

connect({ dialect: "sqlite", filename: "./app.db" }); // or ":memory:"

// Postgres: same call, different config
// connect({ dialect: "postgres", connectionString: process.env.DATABASE_URL });
```

`connect()` also accepts an already-built Knex instance if you need options the shorthand doesn't cover.

**2. Define a model.** One file per model works well.

```js
// models/post.js
import { createModel } from "@kiri-orm/core";

export const Post = createModel("post", {
  fields: {
    id: { type: "integer", required: true },
    title: { type: "char", required: true, maxLength: 120 },
    body: { type: "text" },
    published: { type: "boolean", default: false },
    createdAt: { type: "datetime", default: () => new Date() },
  },
});
```

Field names are camelCase; tables and columns become snake_case (`createdAt` → `created_at`).

**3. Create the tables.**

```js
import "./db.js";
import "./models/post.js"; // importing a model file registers it
import { syncModels } from "@kiri-orm/core";

await syncModels(); // safe on every start: it only creates what's missing
```

**4. Use the model from anywhere.** There is no client object to pass around.

```js
import { Post } from "./models/post.js";

const post = await Post.create({ title: "Hello, kiri-orm" }); // id is assigned for you
post.published = true;
await post.save(); // writes only the changed column

const drafts = await Post.find({ published: false });
const one = await Post.findOne({ id: 1 });

await Post.updateMany({ published: false }, { published: true });
await Post.deleteMany({ id: 1 });
```

Data is validated and cast against the field definitions before any SQL runs, and values come
back as real JavaScript types (`Date`, `boolean`, parsed JSON).

## Field types

`char` · `text` · `integer` · `float` · `boolean` · `date` · `datetime` · `json` · `uuid` · `enum`

Common options: `required`, `unique`, `index`, `default`, `maxLength`. An `enum` takes
`values: [...]` and is enforced by a real `CHECK` constraint.

## Querying

Filters are a plain object (exact match, ANDed) or a **domain**, an Odoo-style array for
everything else:

```js
await Post.find({ published: true, authorId: 7 });

await Post.find([
  ["status", "=", "done"],
  ["amount", ">", 100],
]);

await Post.find(["|", ["status", "=", "draft"], ["status", "=", "archived"]]);
await Post.find(["!", ["status", "=", "draft"]]);
```

Operators: `=` `!=` `>` `>=` `<` `<=` `in` `not in` `like` `ilike`. `ilike` behaves the same on
SQLite and Postgres. Filters can cross relations: `[["customer.country", "=", "UK"]]`.

## Relations

`hasOne`, `hasMany`, `belongsTo` and `belongsToMany`, declared next to the fields:

```js
export const Comment = createModel("comment", {
  fields: {
    id: { type: "integer", required: true },
    postId: { type: "integer", required: true },
    body: { type: "text" },
    likes: { type: "integer" },
  },
  relations: {
    post: {
      type: "belongsTo",
      model: "post",
      foreignKey: "postId",
      onDelete: "cascade",
    },
  },
});
```

Load them with `with`, to any depth, at one query per relation:

```js
const post = await Post.findOne({ id: 1 }, { with: ["author", "comments"] });
post.author; // a document, or null
post.comments; // an array

await Order.find({}, { with: ["items.product.tags"] });

// constrain what loads, per parent
await Post.find(
  { status: "published" },
  {
    with: {
      comments: { where: [["likes", ">", 2]], orderBy: "-likes", limit: 3 },
    },
  },
);
```

### Foreign keys and `onDelete`

Every `belongsTo` is created as a real database foreign key. `onDelete` is `"restrict"`,
`"cascade"` or `"setNull"`; if you don't say, a `required` key restricts and an optional one sets
null. Deleting a row that something still references with `restrict` throws a `RelationError`.
Pivot tables for `belongsToMany` cascade on both sides.

Index the column that holds the foreign key (`index: true`) when the table is large: the
database checks it on every delete of the parent row. Set `constraint: false` on a relation to
opt out of the database constraint for legacy tables or keys into another database (the ORM then applies
`onDelete` itself in JavaScript).

## Aggregates and pagination

```js
await Order.count({ status: "paid" });
await Order.sum("total", { status: "paid" });
await Order.avg("qty");

const page = await Post.paginate(
  { status: "published" },
  { page: 2, perPage: 20, orderBy: "-views", with: ["author"] },
);
// { items, page, perPage, total, pageCount, hasNext, hasPrevious }
```

`aggregate()` handles grouping and several figures at once, all in one statement in the database.

```js
await Order.aggregate(
  [
    ["status", "!=", "cancelled"],
    ["revenue", ">", 1000],
  ],
  {
    groupBy: ["customerId", "placedAt:month"],
    aggregates: {
      orders: "count",
      revenue: { sum: "total" },
      biggest: { max: "total" },
    },
    orderBy: "-revenue",
    limit: 10,
  },
);
// [{ customerId: 7, placedAt_month: Date(2024-02-01), orders: 12, revenue: 5400, biggest: 900 }, …]
```

## Transactions

Every method accepts `{ trx }`. If the callback throws, nothing in it is committed.

```js
import { transaction } from "@kiri-orm/core";

await transaction(async (trx) => {
  const order = await Order.create({ customerId: 7 }, { trx });
  await OrderItem.createMany(
    items.map((i) => ({ orderId: order.id, ...i })),
    { trx },
  );
});
```

## Hooks and computed fields

```js
createModel("post", {
  fields: {
    /* ... */
  },
  hooks: {
    beforeCreate(data) {
      data.slug ??= slugify(data.title);
    },
    afterCreate(post) {
      console.log("created", post.id);
    },
  },
});
```

Hooks: `beforeCreate`, `afterCreate`, `beforeUpdate`, `afterUpdate`, `beforeSave`, `afterSave`,
`beforeDelete`, `afterDelete`.

A computed field is derived when read, never stored, and can still be filterable:

```js
fullName: {
  type: "char",
  depends: ["firstName", "lastName"],
  compute: (r) => `${r.firstName} ${r.lastName}`,
},
```

## Models across many files

Rather than keeping a list of imports, point `loadModels()` at your model files. Each file's
`createModel()` call registers itself, and order doesn't matter:

```js
import { connect, loadModels, syncModels } from "@kiri-orm/core";

connect({ dialect: "sqlite", filename: "./app.db" });
await loadModels("./src/**/*.model.js"); // glob, or an array of globs; "!" excludes
await syncModels();
```

To add fields to a model another package defined, use `extendModel()`; to share fields between
models, use `defineMixin()`.

## The `orm` CLI

```bash
npm install @kiri-orm/cli
```

| Command                    | What it does                                                  |
| -------------------------- | ------------------------------------------------------------- |
| `orm sync`                 | Create missing tables and columns                             |
| `orm migrate:generate`     | Diff your models against the recorded schema into a migration |
| `orm migrate:up` / `down`  | Apply or roll back migrations                                 |
| `orm inspect:model <name>` | Show a model as the database has it recorded                  |
| `orm generate:dto`         | Write JSON Schemas and JSDoc typedefs for every model         |
| `orm sequences:fix`        | Re-sync Postgres id sequences after inserting ids by hand     |

It reads a small config file, so it works without your app running:

```js
// orm.config.js
export default {
  connection: { dialect: "sqlite", filename: "./app.db" },
  models: "./src/**/*.model.js", // the same globs as loadModels()
};
```

## Two APIs, one engine

The examples above use the **Global API**: call `connect()` once and import models anywhere. If
you need several connections at once, or an identity map scoped to a single request, the **Client
API** wraps the same engine in an object you pass around explicitly:

```js
import { createClient } from "@kiri-orm/core";

const postModel = {
  name: "post",
  fields: {
    id: { type: "integer", required: true },
    title: { type: "char", required: true },
  },
};

const client = createClient(
  { dialect: "sqlite", filename: "./app.db" },
  { models: [postModel] },
);
await client.sync(); // not called for you; creates missing tables, additive only
const post = await client.models.post.create({ title: "Hello" });
```

The Global API deliberately has no identity map: two `Post.findOne({ id: 1 })` calls return two
different objects. Opt in with `withIdentityMap(fn)` when you want one.

## Also included

- **Reports:** `createReport()` defines a read-only, aggregated model for dashboards and exports.
- **DTO generation:** `generateModelDTOs("post")` returns create / update / read JSON Schemas
  built from the same field definitions.
- **N+1 detection:** the ORM can flag a query that is repeated per row.
- **Bulk inserts:** `createMany()` for large batches.

## Good to know

- **No silent schema changes.** A field that disappears from your code is flagged in the
  metadata rather than dropped, and changing a field's `type` is never auto-migrated.
- **SQLite and Postgres only.** Other databases are not supported.
- **Pre-1.0.** The API may still change between minor versions.

## Documentation

The full guide covers every option above in depth, including migrations, inheritance, reports
and the Client API. See the docs: https://kiri-orm.vercel.app/

## License

See [LICENSE](./LICENSE).
