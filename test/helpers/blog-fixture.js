import { ModelRegistry } from "../../src/models/registry.js";

/**
 * A small blog schema covering every relation shape the bulk-create
 * tests need:
 *
 *   post --hasMany--> comment --hasMany--> reaction     (three levels of nesting)
 *   post --belongsToMany--> tag                         (pivot: post_tag)
 *   post --belongsTo--> author, post --hasOne--> comment (only for "unsupported here" errors)
 *
 * `tag.name` is unique so tests can force a real database error.
 * `comment.likes` has a `min` so tests can force a nested validation error.
 */
export const BLOG_MODELS = [
  {
    name: "post",
    fields: {
      id: { type: "integer", required: true },
      authorId: { type: "integer" },
      title: { type: "char", required: true, maxLength: 60 },
      views: { type: "integer", default: 0 },
      featured: { type: "boolean", default: false },
      meta: { type: "json" },
      publishedAt: { type: "datetime" },
    },
    relations: {
      comments: { type: "hasMany", model: "comment", foreignKey: "postId" },
      tags: { type: "belongsToMany", model: "tag", through: "post_tag", foreignKey: "post_id", otherKey: "tag_id" },
      author: { type: "belongsTo", model: "author", foreignKey: "authorId" },
      pinned: { type: "hasOne", model: "comment", foreignKey: "postId" },
    },
  },
  {
    name: "comment",
    fields: {
      id: { type: "integer", required: true },
      postId: { type: "integer", required: true },
      body: { type: "char" },
      likes: { type: "integer", min: 0, default: 0 },
    },
    relations: {
      reactions: { type: "hasMany", model: "reaction", foreignKey: "commentId" },
    },
  },
  {
    name: "reaction",
    fields: {
      id: { type: "integer", required: true },
      commentId: { type: "integer", required: true },
      emoji: { type: "char", required: true },
    },
  },
  {
    name: "tag",
    fields: {
      id: { type: "integer", required: true },
      name: { type: "char", required: true, unique: true },
    },
  },
  {
    name: "author",
    fields: {
      id: { type: "integer", required: true },
      name: { type: "char", required: true },
    },
  },
];

export function buildBlogRegistry() {
  const registry = new ModelRegistry();
  for (const model of BLOG_MODELS) registry.define(model);
  return registry;
}

/**
 * Statements that actually touch data - drops BEGIN/COMMIT/ROLLBACK/SAVEPOINT bookkeeping, and
 * the Postgres-only `setval` that keeps an auto-increment sequence ahead of explicit ids
 * (see sequenceStatements()). Without dropping it, the same test would count one more
 * statement on Postgres than on SQLite whenever a batch carries explicit ids.
 */
export function dataStatements(queries) {
  return queries.filter(({ sql }) => !/^\s*(begin|commit|rollback|savepoint|release)/i.test(sql) && !isSequenceStatement(sql));
}

const isSequenceStatement = (sql) => /^\s*select setval\(/i.test(sql);

/** Just the sequence-maintenance statements (Postgres only; always empty on SQLite). */
export function sequenceStatements(queries) {
  return queries.filter(({ sql }) => isSequenceStatement(sql));
}
