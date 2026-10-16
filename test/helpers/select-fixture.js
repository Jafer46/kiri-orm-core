import { ModelRegistry } from "../../src/models/registry.js";
import { sync } from "../../src/schema/sync.js";
import { toRow } from "../../src/crud/row-mapping.js";
import { Repository } from "../../src/crud/repository.js";
import { OrmClient } from "../../src/client/orm-client.js";
import { HookRegistry } from "../../src/uow/hooks.js";
import { connect, createModel, syncModels, __resetGlobalStateForTests } from "../../src/global/index.js";

/**
 * Models for the field-selection tests. Covers every relation type, a computed field that
 * depends on stored fields, one that depends on another computed field, and the column types
 * whose value shape differs by dialect (json, datetime).
 *
 *   post --belongsTo--> author          post --hasMany--> comment --belongsTo--> author (as `user`)
 *   post --belongsToMany--> tag         post --hasOne--> comment (as `pinned`)
 */
export const SELECT_MODELS = [
  {
    name: "author",
    fields: {
      id: { type: "integer", required: true },
      firstName: { type: "char", required: true },
      lastName: { type: "char", required: true },
      email: { type: "char" },
      bio: { type: "text" },
      fullName: { type: "char", depends: ["firstName", "lastName"], compute: (r) => `${r.firstName} ${r.lastName}` },
      initials: { type: "char", depends: ["firstName", "lastName"], compute: (r) => `${r.firstName[0]}${r.lastName[0]}` },
      badge: { type: "char", depends: ["fullName"], compute: (r) => `[${r.fullName}]` }, // computed -> computed
      always: { type: "char", compute: () => "const" }, // depends on nothing
    },
  },
  {
    name: "tag",
    fields: { id: { type: "integer", required: true }, name: { type: "char", required: true }, color: { type: "char" } },
  },
  {
    name: "comment",
    fields: {
      id: { type: "integer", required: true },
      postId: { type: "integer", required: true },
      userId: { type: "integer" },
      body: { type: "char" },
      likes: { type: "integer", default: 0 },
    },
    relations: { user: { type: "belongsTo", model: "author", foreignKey: "userId" } },
  },
  {
    name: "post",
    fields: {
      id: { type: "integer", required: true },
      authorId: { type: "integer" },
      title: { type: "char", required: true },
      body: { type: "text" },
      views: { type: "integer", default: 0 },
      status: { type: "char", default: "draft" },
      meta: { type: "json" },
      publishedAt: { type: "datetime" },
    },
    relations: {
      author: { type: "belongsTo", model: "author", foreignKey: "authorId" },
      comments: { type: "hasMany", model: "comment", foreignKey: "postId" },
      pinned: { type: "hasOne", model: "comment", foreignKey: "postId" },
      tags: { type: "belongsToMany", model: "tag", through: "post_tag", foreignKey: "post_id", otherKey: "tag_id" },
    },
  },
];

// Field names map to snake_case columns (authorId -> author_id), so raw seed rows go through toRow().
const columnRegistry = new ModelRegistry();
for (const model of SELECT_MODELS) columnRegistry.define(model);

/** Inserts rows written with field names, bypassing the ORM's own write path so ids are explicit. */
export async function insertRows(db, modelName, rows) {
  const model = columnRegistry.getModel(modelName);
  await db(model.tableName).insert(rows.map((row) => toRow(model, row)));
}

export const SURFACES = ["repository", "client", "global"];

/**
 * `api.handle(model)` returns the model's own object for that surface (a Repository, a client
 * `ModelHandle`, or a global `createModel()` handle) - for methods beyond find, like aggregate().
 * Pass `models` to build the API over a different set of model definitions.
 *
 * One uniform handle over the three ways to read: a bare Repository (plain records, nothing
 * tracked), `client.models.*` (UnitOfWork entities) and the global `createModel()` API
 * (documents). `tracked` is true for the last two - they always include the primary key.
 */
export async function makeApi(surface, db, models = SELECT_MODELS) {
  const tracked = surface !== "repository";

  if (surface === "global") {
    __resetGlobalStateForTests();
    connect(db);
    const handles = {};
    for (const { name, ...definition } of models) handles[name] = createModel(name, definition);
    await syncModels();
    return {
      surface, tracked, db,
      handle: (model) => handles[model],
      find: (model, filter, options) => handles[model].find(filter, options),
      findOne: (model, filter, options) => handles[model].findOne(filter, options),
    };
  }

  const registry = new ModelRegistry();
  for (const model of models) registry.define(model);
  await sync(db, registry);

  if (surface === "client") {
    const client = new OrmClient(db, registry, new HookRegistry());
    return {
      surface, tracked, db, client, registry,
      handle: (model) => client.models[model],
      find: (model, filter, options) => client.models[model].find(filter, options),
      findOne: (model, filter, options) => client.models[model].findOne(filter, options),
    };
  }

  const repo = (model) => new Repository(db, registry.getModel(model), undefined, registry);
  return {
    surface, tracked, db, registry, repo,
    handle: (model) => repo(model),
    find: (model, filter, options) => repo(model).find(filter, options),
    findOne: (model, filter, options) => repo(model).findOne(filter, options),
  };
}

/** Small fixed dataset with known relationships (see the assertions in the tests). */
export async function seed(db) {
  await insertRows(db, "author", [
    { id: 1, firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", bio: "first programmer" },
    { id: 2, firstName: "Alan", lastName: "Turing", email: "alan@example.com", bio: "machines" },
  ]);
  await insertRows(db, "tag", [
    { id: 1, name: "math", color: "red" },
    { id: 2, name: "code", color: "blue" },
    { id: 3, name: "ai", color: "green" },
  ]);
  await insertRows(db, "post", [
    { id: 1, authorId: 1, title: "P1", body: "b1", views: 10, status: "published", meta: JSON.stringify({ a: 1 }), publishedAt: new Date("2024-01-02T03:04:05Z") },
    { id: 2, authorId: 1, title: "P2", body: "b2", views: 20, status: "published" },
    { id: 3, authorId: 2, title: "P3", body: "b3", views: 5, status: "draft" },
    { id: 4, authorId: null, title: "P4", body: "b4", views: 0, status: "draft" },
  ]);
  await insertRows(db, "comment", [
    { id: 1, postId: 1, userId: 2, body: "c1", likes: 3 },
    { id: 2, postId: 1, userId: 1, body: "c2", likes: 1 },
    { id: 3, postId: 2, userId: 2, body: "c3", likes: 0 },
  ]);
  await db("post_tag").insert([
    { post_id: 1, tag_id: 1 }, { post_id: 1, tag_id: 2 }, { post_id: 2, tag_id: 2 }, { post_id: 3, tag_id: 3 },
  ]);
}

/** `n` posts with 2 comments (by 2 different authors) and 2 tags each - to prove query counts don't grow. */
export async function seedMany(db, n) {
  await insertRows(db, "author", [{ id: 1, firstName: "Ada", lastName: "Lovelace" }, { id: 2, firstName: "Alan", lastName: "Turing" }]);
  await insertRows(db, "tag", [{ id: 1, name: "t1" }, { id: 2, name: "t2" }]);
  const posts = [], comments = [], links = [];
  for (let i = 1; i <= n; i++) {
    posts.push({ id: i, authorId: (i % 2) + 1, title: `P${i}`, views: i });
    comments.push({ id: i * 2 - 1, postId: i, userId: 1, body: `a${i}` }, { id: i * 2, postId: i, userId: 2, body: `b${i}` });
    links.push({ post_id: i, tag_id: 1 }, { post_id: i, tag_id: 2 });
  }
  for (let i = 0; i < posts.length; i += 50) {
    await insertRows(db, "post", posts.slice(i, i + 50));
    await insertRows(db, "comment", comments.slice(i * 2, i * 2 + 100));
    await db("post_tag").insert(links.slice(i * 2, i * 2 + 100));
  }
}

/**
 * Three posts with known comments and tags:
 *
 *   post 1 "A" (Ada)   comments c1(5 likes) c2(3) c3(9) c4(1)    tags alpha beta gamma
 *   post 2 "B" (Alan)  comments c5(2) c6(8)                     tags beta gamma
 *   post 3 "C" (Ada)   no comments                               no tags
 *
 * (comment ids are 1..6 in that order; users alternate Ada/Alan: c1 Ada, c2 Alan, c3 Ada, c4 Alan, c5 Ada, c6 Alan)
 */
export async function seedConstrained(db) {
  await insertRows(db, "author", [
    { id: 1, firstName: "Ada", lastName: "Lovelace" },
    { id: 2, firstName: "Alan", lastName: "Turing" },
  ]);
  await insertRows(db, "post", [
    { id: 1, authorId: 1, title: "A" }, { id: 2, authorId: 2, title: "B" }, { id: 3, authorId: 1, title: "C" },
  ]);
  // Inserted in REVERSE id order on purpose: if a query forgets its primary-key tiebreaker, the rows come back
  // in physical (insertion) order, which here is the opposite of id order - so the mistake can't hide.
  await insertRows(db, "comment", [
    { id: 1, postId: 1, userId: 1, body: "c1", likes: 5 }, { id: 2, postId: 1, userId: 2, body: "c2", likes: 3 },
    { id: 3, postId: 1, userId: 1, body: "c3", likes: 9 }, { id: 4, postId: 1, userId: 2, body: "c4", likes: 1 },
    { id: 5, postId: 2, userId: 1, body: "c5", likes: 2 }, { id: 6, postId: 2, userId: 2, body: "c6", likes: 8 },
  ].reverse());
  await insertRows(db, "tag", [{ id: 1, name: "alpha" }, { id: 2, name: "beta" }, { id: 3, name: "gamma" }]);
  await db("post_tag").insert([
    { post_id: 1, tag_id: 1 }, { post_id: 1, tag_id: 2 }, { post_id: 1, tag_id: 3 }, { post_id: 2, tag_id: 2 }, { post_id: 2, tag_id: 3 },
  ]);
}
