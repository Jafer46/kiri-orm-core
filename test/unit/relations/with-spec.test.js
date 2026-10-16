import { describe, it, expect } from "vitest";
import { ModelRegistry } from "../../../src/models/registry.js";
import { normalizeWith, parentKeysNeeded } from "../../../src/relations/with-spec.js";
import { RelationError } from "../../../src/relations/errors.js";
import { ValidationError } from "../../../src/crud/errors.js";

const registry = new ModelRegistry();
registry.define({ name: "user", fields: { id: { type: "integer", required: true }, name: { type: "char" } } });
registry.define({
  name: "comment",
  fields: { id: { type: "integer", required: true }, postId: { type: "integer" }, userId: { type: "integer" }, body: { type: "char" } },
  relations: { user: { type: "belongsTo", model: "user", foreignKey: "userId" } },
});
registry.define({
  name: "post",
  fields: { id: { type: "integer", required: true }, authorId: { type: "integer" }, title: { type: "char" } },
  relations: {
    author: { type: "belongsTo", model: "user", foreignKey: "authorId" },
    comments: { type: "hasMany", model: "comment", foreignKey: "postId" },
  },
});
const post = registry.getModel("post");

const shape = (tree) => Object.fromEntries([...tree].map(([name, node]) => [name, { select: node.select, with: shape(node.with) }]));
const norm = (input) => shape(normalizeWith(post, registry, input));

describe("normalizeWith", () => {
  it("gives an empty tree for nothing", () => {
    expect(norm(undefined)).toEqual({});
    expect(norm([])).toEqual({});
    expect(norm({})).toEqual({});
  });

  it("reads names and dotted paths as bare entries (select: null = every field)", () => {
    expect(norm(["author", "comments.user"])).toEqual({
      author: { select: null, with: {} },
      comments: { select: null, with: { user: { select: null, with: {} } } },
    });
  });

  it("reads the object forms", () => {
    expect(norm({ author: { select: ["name"] }, comments: ["body"] })).toEqual({
      author: { select: ["name"], with: {} },
      comments: { select: ["body"], with: {} },
    });
    expect(norm({ comments: { select: ["body"], with: { user: { select: ["name"] } } } })).toEqual({
      comments: { select: ["body"], with: { user: { select: ["name"], with: {} } } },
    });
  });

  it("applies a dotted key's spec to its last segment", () => {
    expect(norm({ "comments.user": ["name"] })).toEqual({
      comments: { select: null, with: { user: { select: ["name"], with: {} } } },
    });
  });

  it("merges repeats: selects are unioned, an explicit select beats a bare name, children are merged", () => {
    expect(norm(["comments.user", { comments: ["body"] }, { comments: ["body", "id"] }])).toEqual({
      comments: { select: ["body", "id"], with: { user: { select: null, with: {} } } },
    });
  });

  it("skips false/null entries and accepts true", () => {
    expect(norm({ author: false, comments: true })).toEqual({ comments: { select: null, with: {} } });
  });

  it.each([
    [{ nope: true }, RelationError, /Unknown relation "nope" on model "post"/],
    [["comments.nope"], RelationError, /Unknown relation "nope" on model "comment"/],
    [{ author: { select: ["nope"] } }, ValidationError, /unknown field "nope"/],
    [{ author: { selct: ["name"] } }, RelationError, /Unknown option "selct"/],
    [{ author: 7 }, RelationError, /must be true, an array/],
    [[7], RelationError, /relation names or objects/],
    [["a..b"], RelationError, /Invalid `with` path/],
  ])("rejects %j", (input, ErrorClass, message) => {
    expect(() => normalizeWith(post, registry, input)).toThrow(ErrorClass);
    expect(() => normalizeWith(post, registry, input)).toThrow(message);
  });
});

describe("parentKeysNeeded", () => {
  it("is the foreign key for belongsTo and the local key for the others, without duplicates", () => {
    const tree = normalizeWith(post, registry, ["author", "comments"]);
    expect(parentKeysNeeded(post, registry, tree).sort()).toEqual(["authorId", "id"]);
    expect(parentKeysNeeded(post, registry, new Map())).toEqual([]);
  });
});
