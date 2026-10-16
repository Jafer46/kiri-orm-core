import { describe, it, expect } from "vitest";
import { defineModel } from "../../../src/models/define-model.js";
import { InvalidModelDefinitionError } from "../../../src/models/errors.js";
import { primaryKeyOf, primaryKeyColumnOf, requirePrimaryKey } from "../../../src/models/primary-key.js";

describe("declared primary keys", () => {
  it("defaults to a field named id, same as before", () => {
    const model = defineModel({ name: "post", fields: { id: { type: "integer", required: true }, title: { type: "char" } } });
    expect(model.primaryKey).toBe("id");
    expect(model.fields.id.primary).toBe(true);
    expect(model.fields.id.autoId).toBe("increment");
  });

  it("`primaryKey` on the model picks a different field", () => {
    const model = defineModel({
      name: "tag",
      primaryKey: "code",
      fields: { code: { type: "char", required: true }, name: { type: "char" } },
    });
    expect(model.primaryKey).toBe("code");
    expect(model.fields.code.primary).toBe(true);
    // A non-integer/uuid primary key is never auto-assigned.
    expect(model.fields.code.autoId).toBeUndefined();
  });

  it("`primaryKey: true` on a field is equivalent", () => {
    const model = defineModel({
      name: "account",
      fields: { acctId: { type: "uuid", required: true, primaryKey: true }, email: { type: "char" } },
    });
    expect(model.primaryKey).toBe("acctId");
    expect(model.fields.acctId.autoId).toBe("uuid");
  });

  it("a field literally named id that isn't the primary key is not auto-assigned or made PRIMARY KEY", () => {
    const model = defineModel({
      name: "legacy",
      primaryKey: "code",
      fields: { code: { type: "char", required: true }, id: { type: "integer" } },
    });
    expect(model.fields.id.primary).toBe(false);
    expect(model.fields.id.autoId).toBeUndefined();
  });

  it("a model with neither an id field nor a declared primaryKey has none", () => {
    const model = defineModel({ name: "lookup", fields: { name: { type: "char", required: true } } });
    expect(model.primaryKey).toBeNull();
  });

  it("rejects composite primary keys", () => {
    expect(() =>
      defineModel({ name: "bad", primaryKey: ["a", "b"], fields: { a: { type: "char" }, b: { type: "char" } } })
    ).toThrow(/composite primary keys aren't supported/);
  });

  it("rejects more than one field flagged primaryKey: true", () => {
    expect(() =>
      defineModel({
        name: "bad",
        fields: { a: { type: "char", primaryKey: true }, b: { type: "char", primaryKey: true } },
      })
    ).toThrow(/more than one field is marked/);
  });

  it("rejects a primaryKey option that conflicts with a field flag", () => {
    expect(() =>
      defineModel({
        name: "bad",
        primaryKey: "a",
        fields: { a: { type: "char" }, b: { type: "char", primaryKey: true } },
      })
    ).toThrow(/but field "b" is marked/);
  });

  it("rejects a primaryKey naming an unknown or computed field", () => {
    expect(() =>
      defineModel({ name: "bad", primaryKey: "nope", fields: { a: { type: "char" } } })
    ).toThrow(/not a stored field/);
  });

  it("rejects json or boolean as a primary key", () => {
    expect(() => defineModel({ name: "bad", primaryKey: "j", fields: { j: { type: "json" } } })).toThrow(
      /can't be a primary key/
    );
    expect(() => defineModel({ name: "bad2", primaryKey: "b", fields: { b: { type: "boolean" } } })).toThrow(
      /can't be a primary key/
    );
  });

  describe("primaryKeyOf / primaryKeyColumnOf / requirePrimaryKey", () => {
    it("read the declared key and its column", () => {
      const model = defineModel({ name: "tag", primaryKey: "code", fields: { code: { type: "char", required: true } } });
      expect(primaryKeyOf(model)).toBe("code");
      expect(primaryKeyColumnOf(model)).toBe(model.columns.code);
    });

    it("falls back to `id` for a bare descriptor with no primaryKey property at all", () => {
      // Simulates a descriptor built by hand, or recovered from JSON, predating declared keys.
      expect(primaryKeyOf({ fields: { id: {}, title: {} } })).toBe("id");
      expect(primaryKeyOf({ fields: { title: {} } })).toBeNull();
    });

    it("requirePrimaryKey throws a custom error class with a helpful message when there is none", () => {
      const model = defineModel({ name: "lookup", fields: { name: { type: "char" } } });
      expect(() => requirePrimaryKey(model, "attach()", InvalidModelDefinitionError)).toThrow(
        /attach\(\) needs a primary key/
      );
    });

    it("requirePrimaryKey returns the key when there is one", () => {
      const model = defineModel({ name: "post", fields: { id: { type: "integer", required: true } } });
      expect(requirePrimaryKey(model, "attach()", InvalidModelDefinitionError)).toBe("id");
    });
  });
});
