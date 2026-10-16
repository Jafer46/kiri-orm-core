import { describe, it, expect } from "vitest";
import { Command, isCommand, normalizeRelationValue } from "../../src/relations/commands.js";
import { RelationError } from "../../src/relations/errors.js";

const hasMany = { type: "hasMany", model: "comment", foreignKey: "postId", localKey: "id" };
const m2m = { type: "belongsToMany", model: "tag", through: "post_tag", foreignKey: "post_id", otherKey: "tag_id", localKey: "id" };
const norm = (relation, value) => normalizeRelationValue("post", "rel", relation, value);

describe("Command constructors", () => {
  it("build frozen, recognizable commands", () => {
    const create = Command.create({ a: 1 });
    expect(isCommand(create)).toBe(true);
    expect(isCommand(Command.link(3))).toBe(true);
    expect(isCommand(Command.set([1, 2]))).toBe(true);
    expect(Object.isFrozen(create)).toBe(true);
  });

  it("isCommand rejects lookalikes", () => {
    expect(isCommand({ type: "create", values: {} })).toBe(false);
    expect(isCommand(null)).toBe(false);
    expect(isCommand(5)).toBe(false);
  });

  it("validate their arguments at construction", () => {
    expect(() => Command.create(null)).toThrow(TypeError);
    expect(() => Command.create([1])).toThrow(TypeError);
    expect(() => Command.link({})).toThrow(TypeError);
    expect(() => Command.link("")).toThrow(TypeError);
    expect(() => Command.link(NaN)).toThrow(TypeError);
    expect(() => Command.set(5)).toThrow(TypeError);
    expect(() => Command.set([1, null])).toThrow(TypeError);
  });

  it("set() copies its array so later mutation can't change the command", () => {
    const ids = [1, 2];
    const command = Command.set(ids);
    ids.push(3);
    expect(command.ids).toEqual([1, 2]);
  });

  it("works as an array.map callback", () => {
    const commands = [{ a: 1 }, { a: 2 }].map(Command.create);
    expect(commands.map((c) => c.values)).toEqual([{ a: 1 }, { a: 2 }]);
  });
});

describe("normalizeRelationValue", () => {
  it("flattens commands and bare ids into create/link operations, remembering source positions", () => {
    expect(norm(m2m, [7, Command.link(8), Command.create({ n: 1 }), Command.set([9, 10])])).toEqual([
      { type: "link", id: 7, index: 0 },
      { type: "link", id: 8, index: 1 },
      { type: "create", values: { n: 1 }, index: 2 },
      { type: "link", id: 9, index: 3 },
      { type: "link", id: 10, index: 3 }, // set() expands but keeps its own position
    ]);
  });

  it("accepts string ids", () => {
    expect(norm(hasMany, ["abc"])).toEqual([{ type: "link", id: "abc", index: 0 }]);
  });

  it("returns an empty list for an empty array", () => {
    expect(norm(hasMany, [])).toEqual([]);
  });

  it("rejects a plain object and explains how to say 'create'", () => {
    expect(() => norm(hasMany, [{ body: "x" }])).toThrow(/Command\.create/);
    expect(() => norm(hasMany, [{ body: "x" }])).toThrow(/entry \[0\]/);
  });

  it("rejects entries that are neither commands nor ids", () => {
    for (const bad of [null, undefined, true, [1], () => {}]) {
      expect(() => norm(hasMany, [bad])).toThrow(RelationError);
    }
  });

  it("rejects a non-array value", () => {
    for (const bad of [5, "x", {}, null, Command.link(1)]) {
      expect(() => norm(m2m, bad)).toThrow(/expects an array/);
    }
  });

  it("says what to do instead for belongsTo, and why hasOne is unsupported", () => {
    const belongsTo = { type: "belongsTo", model: "author", foreignKey: "authorId" };
    const hasOne = { type: "hasOne", model: "profile", foreignKey: "userId" };
    expect(() => norm(belongsTo, [1])).toThrow(/foreign key field "authorId"/);
    expect(() => norm(hasOne, [1])).toThrow(/hasOne/);
  });
});
