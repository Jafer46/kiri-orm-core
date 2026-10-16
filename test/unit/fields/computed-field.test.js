import { describe, it, expect } from "vitest";
import { defineModel } from "../../../src/models/define-model.js";
import { defineField } from "../../../src/fields/define-field.js";
import { defineComputedField, isComputedField } from "../../../src/fields/define-computed-field.js";
import { defineComputedGetters } from "../../../src/fields/computed-access.js";
import { InvalidModelDefinitionError } from "../../../src/models/errors.js";
import { InvalidFieldDefinitionError } from "../../../src/fields/errors.js";

const person = (extraFields = {}) => ({
  name: "person",
  fields: {
    id: { type: "integer", required: true },
    first: { type: "char" },
    last: { type: "char" },
    ...extraFields,
  },
});
const fullName = { type: "char", depends: ["first", "last"], compute: (r) => `${r.first} ${r.last}` };

describe("defineComputedField", () => {
  it("returns a frozen descriptor with depends defaulted and de-duplicated", () => {
    const field = defineComputedField({ type: "char", compute: () => "x", depends: ["a", "a", "b"] });
    expect(Object.isFrozen(field)).toBe(true);
    expect([...field.depends]).toEqual(["a", "b"]);
    expect([...defineComputedField({ type: "char", compute: () => "x" }).depends]).toEqual([]);
  });

  it("recognizes a computed field by its `compute` option alone", () => {
    expect(isComputedField({ type: "char", compute: () => 1 })).toBe(true);
    expect(isComputedField({ type: "char" })).toBe(false);
    expect(isComputedField(null)).toBe(false);
  });

  it("needs a registered type, a compute function, and valid depends/search", () => {
    expect(() => defineComputedField({ compute: () => 1 })).toThrow(/requires a `type`/);
    expect(() => defineComputedField({ type: "nope", compute: () => 1 })).toThrow();
    expect(() => defineComputedField({ type: "char", compute: "x" })).toThrow(/`compute` must be a function/);
    expect(() => defineComputedField({ type: "char", compute: () => 1, depends: "a" })).toThrow(/`depends` must be an array/);
    expect(() => defineComputedField({ type: "char", compute: () => 1, depends: [1] })).toThrow(/`depends`/);
    expect(() => defineComputedField({ type: "char", compute: () => 1, search: "x" })).toThrow(/`search` must be a function/);
  });

  it("refuses options that describe a column, since there isn't one", () => {
    for (const option of ["required", "unique", "index", "default", "column"]) {
      expect(() => defineComputedField({ type: "char", compute: () => 1, [option]: true }), option).toThrow(
        new RegExp(`\`${option}\` can't be set on a computed field`)
      );
    }
  });

  it("explains why stored computed fields aren't offered, and accepts an explicit store: false", () => {
    expect(() => defineComputedField({ type: "char", compute: () => 1, store: true })).toThrow(/not supported.*beforeSave hook/);
    expect(() => defineComputedField({ type: "char", compute: () => 1, store: false })).not.toThrow();
  });
});

describe("defineField on a stored field", () => {
  it("rejects `search` and `depends`, which mean nothing without `compute`", () => {
    expect(() => defineField({ type: "char", search: () => [] })).toThrow(InvalidFieldDefinitionError);
    expect(() => defineField({ type: "char", depends: ["x"] })).toThrow(/only apply to computed fields/);
  });
});

describe("defineModel with computed fields", () => {
  it("keeps stored fields in `fields` and computed ones in `computed`, and gives computed no column", () => {
    const model = defineModel(person({ fullName }));
    expect(Object.keys(model.fields)).toEqual(["id", "first", "last"]);
    expect(Object.keys(model.computed)).toEqual(["fullName"]);
    expect(model.columns).not.toHaveProperty("fullName");
    expect(Object.isFrozen(model.computed)).toBe(true);
  });

  it("gives every model a `computed` object, empty when it has none", () => {
    expect(defineModel(person()).computed).toEqual({});
  });

  it("reports a bad computed field with the model and field name", () => {
    expect(() => defineModel(person({ bad: { type: "char", compute: () => 1, required: true } }))).toThrow(
      /Model "person", computed field "bad": `required` can't be set/
    );
  });

  it("requires depends to name real fields (stored or computed) of the same model", () => {
    expect(() => defineModel(person({ x: { type: "char", compute: () => 1, depends: ["ghost"] } }))).toThrow(
      /computed field "x" depends on "ghost".*Known fields: id, first, last, x/
    );
    expect(() =>
      defineModel(person({ a: { type: "char", compute: () => 1, depends: ["first"] }, b: { type: "char", compute: () => 1, depends: ["a"] } }))
    ).not.toThrow(); // depending on another computed field is fine
  });

  it("rejects dependency cycles among computed fields and names the cycle", () => {
    const cyclic = person({
      a: { type: "char", compute: () => 1, depends: ["b"] },
      b: { type: "char", compute: () => 1, depends: ["c"] },
      c: { type: "char", compute: () => 1, depends: ["a"] },
    });
    expect(() => defineModel(cyclic)).toThrow(/cycle \(a -> b -> c -> a\)/);
    expect(() => defineModel(person({ self: { type: "char", compute: () => 1, depends: ["self"] } }))).toThrow(/cycle \(self -> self\)/);
  });

  it("needs at least one stored field", () => {
    expect(() => defineModel({ name: "x", fields: { v: { type: "char", compute: () => 1 } } })).toThrow(/at least one stored field/);
  });

  it("stops a relation from sharing a name with a computed field", () => {
    expect(() =>
      defineModel({ ...person({ author: { type: "char", compute: () => 1 } }), relations: { author: { type: "belongsTo", model: "u", foreignKey: "id" } } })
    ).toThrow(/relation "author" has the same name as a field/);
  });
});

describe("defineComputedGetters", () => {
  const model = defineModel(person({ fullName }));

  it("adds enumerable read-only getters that recompute on every read", () => {
    const record = defineComputedGetters({ first: "Ada", last: "Lovelace" }, model);
    expect(record.fullName).toBe("Ada Lovelace");
    record.first = "Augusta";
    expect(record.fullName).toBe("Augusta Lovelace"); // no cache to go stale
    expect(Object.keys(record)).toContain("fullName");
    expect(JSON.parse(JSON.stringify(record)).fullName).toBe("Augusta Lovelace");
    expect(() => {
      record.fullName = "x";
    }).toThrow(/"fullName" is a computed field on model "person" and is read-only/);
  });

  it("is a no-op for a model with no computed fields", () => {
    const record = { a: 1 };
    expect(defineComputedGetters(record, defineModel(person()))).toBe(record);
    expect(Object.keys(record)).toEqual(["a"]);
  });
});
