import { describe, it, expect } from "vitest";
import { defineModel } from "../../../src/models/define-model.js";
import { normalizeSelect, expandSelect, planSelect, stripHidden, withPrimaryKey } from "../../../src/crud/select.js";
import { ValidationError } from "../../../src/crud/errors.js";

const author = defineModel({
  name: "author",
  fields: {
    id: { type: "integer", required: true },
    firstName: { type: "char" },
    lastName: { type: "char" },
    email: { type: "char" },
    fullName: { type: "char", depends: ["firstName", "lastName"], compute: (r) => `${r.firstName} ${r.lastName}` },
    badge: { type: "char", depends: ["fullName"], compute: (r) => `[${r.fullName}]` },
    constant: { type: "char", compute: () => "x" },
  },
  relations: { posts: { type: "hasMany", model: "post", foreignKey: "authorId" } },
});

describe("normalizeSelect", () => {
  it("returns null for no selection and a de-duplicated array otherwise", () => {
    expect(normalizeSelect(author, undefined)).toBeNull();
    expect(normalizeSelect(author, null)).toBeNull();
    expect(normalizeSelect(author, ["email", "id", "email"])).toEqual(["email", "id"]);
  });

  it("accepts computed fields", () => {
    expect(normalizeSelect(author, ["fullName"])).toEqual(["fullName"]);
  });

  it.each([
    [["nope"], /unknown field "nope"\. Fields: id, firstName.*fullName \(computed\)/],
    [["posts"], /"posts" is a relation, not a field/],
    [[], /at least one field/],
    ["email", /must be an array/],
    [[7], /non-empty strings/],
  ])("rejects %j with a ValidationError on `select`", (input, message) => {
    let error;
    try {
      normalizeSelect(author, input);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.fieldErrors.select[0]).toMatch(message);
  });
});

describe("expandSelect", () => {
  it("passes stored fields through", () => {
    const { fields, computed } = expandSelect(author, ["email", "id"]);
    expect([...fields]).toEqual(["email", "id"]);
    expect(computed.size).toBe(0);
  });

  it("resolves a computed field to its stored dependencies, transitively", () => {
    const { fields, computed } = expandSelect(author, ["badge"]);
    expect([...fields].sort()).toEqual(["firstName", "lastName"]);
    expect([...computed].sort()).toEqual(["badge", "fullName"]);
  });
});

describe("planSelect", () => {
  it("no selection: read everything, define everything, hide nothing", () => {
    expect(planSelect(author, null, ["id"])).toEqual({ columns: null, computed: null, hidden: [] });
  });

  it("maps fields to columns and marks required keys that weren't selected as hidden", () => {
    const plan = planSelect(author, ["email"], ["id", "email"]);
    expect(plan.columns).toEqual(["email", "id"]);
    expect(plan.hidden).toEqual(["id"]);
  });

  it("does not hide a required key that was selected", () => {
    expect(planSelect(author, ["id", "email"], ["id"]).hidden).toEqual([]);
  });

  it("a selection of only dependency-free computed fields still reads one (hidden) column", () => {
    const plan = planSelect(author, ["constant"], []);
    expect(plan.columns).toEqual(["id"]);
    expect(plan.hidden).toEqual(["id"]);
    expect([...plan.computed]).toEqual(["constant"]);
  });
});

describe("stripHidden / withPrimaryKey", () => {
  it("stripHidden removes only the named fields, in place", () => {
    const rows = [{ id: 1, email: "a" }, { id: 2, email: "b" }];
    stripHidden(rows, ["id"]);
    expect(rows).toEqual([{ email: "a" }, { email: "b" }]);
    stripHidden(rows, []); // no-op
    expect(rows).toEqual([{ email: "a" }, { email: "b" }]);
  });

  it("withPrimaryKey adds the key to a selection that lacks it, and nothing else", () => {
    expect(withPrimaryKey(author, { select: ["email"], limit: 3 })).toEqual({ select: ["id", "email"], limit: 3 });
    const already = { select: ["id", "email"] };
    expect(withPrimaryKey(author, already)).toBe(already);
    const none = { limit: 1 };
    expect(withPrimaryKey(author, none)).toBe(none);
  });

  it("withPrimaryKey still validates, so a bad select fails the same way on every API", () => {
    expect(() => withPrimaryKey(author, { select: ["nope"] })).toThrow(ValidationError);
  });
});
