import { describe, it, expect } from "vitest";
import { ModelRegistry } from "../../../src/models/registry.js";
import { defineModel } from "../../../src/models/define-model.js";
import { InvalidModelDefinitionError, ModelConflictError, UnknownModelError } from "../../../src/models/errors.js";

const post = () => ({
  name: "post",
  fields: { id: { type: "integer", required: true }, title: { type: "char", maxLength: 50 } },
});
const registry = () => new ModelRegistry();

describe("extending a model in place (`extend`)", () => {
  it("adds fields to the base model, on the same table, and records who added them", () => {
    const r = registry();
    r.define(post(), { origin: "blog" });
    const result = r.define({ extend: "post", fields: { seoTitle: { type: "char" } } }, { origin: "seo" });

    expect(Object.keys(r.getModel("post").fields)).toEqual(["id", "title", "seoTitle"]);
    expect(r.getModel("post").tableName).toBe("post");
    expect(r.getModel("post").columns.seoTitle).toBe("seo_title");
    expect(result).toBe(r.getModel("post"));
    expect(r.getModel("post").origins).toEqual({ id: 'module "blog"', title: 'module "blog"', seoTitle: 'module "seo"' });
    expect(r.listModels()).toEqual(["post"]); // an extension is not a second model
  });

  it("overrides attributes one by one, keeping the rest of the field", () => {
    const r = registry();
    r.define(post());
    r.define({ extend: "post", fields: { title: { required: true, maxLength: 200 } } });
    expect(r.getModel("post").fields.title).toMatchObject({ type: "char", required: true, maxLength: 200 });
  });

  it("applies extensions in the order they were registered, later ones winning", () => {
    const r = registry();
    r.define(post());
    r.define({ extend: "post", fields: { title: { maxLength: 100 } } });
    r.define({ extend: "post", fields: { title: { maxLength: 300 } } });
    expect(r.getModel("post").fields.title.maxLength).toBe(300);
  });

  it("can add relations and override a relation's options", () => {
    const r = registry();
    r.define({ ...post(), relations: { comments: { type: "hasMany", model: "comment", foreignKey: "postId" } } });
    r.define({ extend: "post", relations: { author: { type: "belongsTo", model: "user", foreignKey: "authorId" }, comments: { foreignKey: "post_ref" } } });
    expect(Object.keys(r.getModel("post").relations)).toEqual(["comments", "author"]);
    expect(r.getModel("post").relations.comments.foreignKey).toBe("post_ref");
    expect(r.getModel("post").relations.comments.type).toBe("hasMany");
  });

  it("never changes a field's type, nor turns stored into computed (either would alter a column)", () => {
    const r = registry();
    r.define(post());
    expect(() => r.define({ extend: "post", fields: { title: { type: "integer" } } }, { origin: "bad" })).toThrow(
      /module "bad" changes its type from "char" to "integer"/
    );
    expect(() => r.define({ extend: "post", fields: { title: { compute: () => "x" } } })).toThrow(/turns a stored field into a computed one/);
    expect(r.getModel("post").fields.title.type).toBe("char"); // untouched by the rejected attempts
  });

  it("can override the compute/search of a computed field - the same-kind override", () => {
    const r = registry();
    r.define({ name: "p", fields: { id: { type: "integer" }, n: { type: "integer", compute: () => 1 } } });
    r.define({ extend: "p", fields: { n: { compute: () => 2 } } });
    expect(r.getModel("p").computed.n.compute()).toBe(2);
  });

  it("can't set its own name, table or abstractness: it shares the extended model's", () => {
    const r = registry();
    r.define(post());
    for (const key of ["name", "table", "abstract"]) {
      expect(() => r.define({ extend: "post", [key]: key === "abstract" ? true : "x", fields: { a: { type: "char" } } })).toThrow(
        new RegExp(`can't set \`${key}\``)
      );
    }
  });

  it("can't introduce a field that clashes with a relation of the same name", () => {
    const r = registry();
    r.define({ ...post(), relations: { comments: { type: "hasMany", model: "comment", foreignKey: "postId" } } });
    expect(() => r.define({ extend: "post", fields: { comments: { type: "char" } } })).toThrow(/relation "comments" has the same name as a field/);
    expect(Object.keys(r.getModel("post").fields)).toEqual(["id", "title"]);
  });

  it("works on a descriptor registered directly with register()", () => {
    const r = registry();
    r.register(defineModel({ ...post(), table: "blog_posts" }));
    r.define({ extend: "post", fields: { extra: { type: "float" } } });
    expect(r.getModel("post").tableName).toBe("blog_posts");
    expect(Object.keys(r.getModel("post").fields)).toEqual(["id", "title", "extra"]);
  });
});

describe("definition order doesn't matter", () => {
  it("an extension registered before its base waits, then applies when the base arrives", () => {
    const r = registry();
    expect(r.define({ extend: "post", fields: { seoTitle: { type: "char" } } }, { origin: "seo" })).toBeNull();
    expect(r.hasModel("post")).toBe(false);
    expect(() => r.getModel("post")).toThrow(UnknownModelError);

    r.define(post(), { origin: "blog" });
    expect(Object.keys(r.getModel("post").fields)).toEqual(["id", "title", "seoTitle"]); // base first, then the extension
  });

  it("chains of waiting definitions resolve together, in arrival order", () => {
    const r = registry();
    r.define({ extend: "post", fields: { b: { type: "char" } } });
    r.define({ extend: "post", fields: { a: { type: "char" } } });
    r.define({ name: "invoice", mixins: ["stamped"], fields: { id: { type: "integer" } } });
    r.define({ name: "stamped", abstract: true, fields: { at: { type: "datetime" } } });
    r.define(post());
    expect(Object.keys(r.getModel("post").fields)).toEqual(["id", "title", "b", "a"]);
    expect(Object.keys(r.getModel("invoice").fields)).toEqual(["at", "id"]);
    r.assertResolved();
  });

  it("a model waiting on a mixin says so, and assertResolved names what never arrived", () => {
    const r = registry();
    r.define({ name: "invoice", mixins: ["stamped"], fields: { id: { type: "integer" } } });
    expect(() => r.getModel("invoice")).toThrow(/defined but not usable yet: it is waiting for "stamped"/);
    r.define({ extend: "ghost", fields: { x: { type: "char" } } }, { origin: "orphan" });

    let error;
    try {
      r.assertResolved();
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(InvalidModelDefinitionError);
    expect(error.message).toContain('Model "invoice" needs "stamped"');
    expect(error.message).toContain('Extension of "ghost" (from module "orphan") needs "ghost"');
  });

  it("a pending definition that turns out invalid fails when applied, and says which one", () => {
    const r = registry();
    r.define({ extend: "post", fields: { title: { type: "integer" } } }, { origin: "bad" });
    expect(() => r.define(post())).toThrow(/Extension of "post" \(from module "bad"\) could not be applied.*changes its type/);
    expect(r.hasModel("post")).toBe(true); // the base itself was fine, and stays registered
    expect(r.getModel("post").fields.title.type).toBe("char");
    r.assertResolved(); // and the failed extension was dropped, not left waiting
  });
});

describe("mixins (abstract models)", () => {
  const stamped = { name: "stamped", abstract: true, fields: { createdAt: { type: "datetime" }, updatedAt: { type: "datetime" } } };

  it("copy fields into a new model without becoming models themselves", () => {
    const r = registry();
    r.define(stamped);
    r.define({ name: "invoice", mixins: ["stamped"], fields: { id: { type: "integer" } } });

    expect(Object.keys(r.getModel("invoice").fields)).toEqual(["createdAt", "updatedAt", "id"]);
    expect(r.getModel("invoice").origins.createdAt).toBe('mixin "stamped"');
    expect(r.listModels()).toEqual(["invoice"]);
    expect(r.hasModel("stamped")).toBe(false);
    expect(r.isAbstract("stamped")).toBe(true);
    expect(r.listAbstract()).toEqual(["stamped"]);
    expect(() => r.getModel("stamped")).toThrow(/is abstract \(a mixin\).*`mixins`/);
  });

  it("give each model its own table: a mixin's name and table never carry over", () => {
    const r = registry();
    r.define(stamped);
    r.define({ name: "a", mixins: ["stamped"], fields: { id: { type: "integer" } } });
    r.define({ name: "b", mixins: ["stamped"], table: "bees", fields: { id: { type: "integer" } } });
    expect([r.getModel("a").tableName, r.getModel("b").tableName]).toEqual(["a", "bees"]);
  });

  it("let a model override what it mixes in, and later mixins override earlier ones", () => {
    const r = registry();
    r.define({ name: "m1", abstract: true, fields: { v: { type: "char", maxLength: 10 } } });
    r.define({ name: "m3", abstract: true, fields: { v: { type: "char", maxLength: 20 } } });
    r.define({ name: "later_wins", mixins: ["m1", "m3"], fields: { id: { type: "integer" } } });
    r.define({ name: "reversed", mixins: ["m3", "m1"], fields: { id: { type: "integer" } } });
    r.define({ name: "own_wins", mixins: ["m1", "m3"], fields: { id: { type: "integer" }, v: { maxLength: 30 } } });
    expect(r.getModel("later_wins").fields.v.maxLength).toBe(20);
    expect(r.getModel("reversed").fields.v.maxLength).toBe(10);
    expect(r.getModel("own_wins").fields.v.maxLength).toBe(30); // the model's own fields beat its mixins
  });

  it("can tweak a field it inherits from another mixin, but only by mixing that one in", () => {
    const r = registry();
    r.define({ name: "base", abstract: true, fields: { v: { type: "char", maxLength: 10 } } });
    r.define({ name: "tweaked", abstract: true, mixins: ["base"], fields: { v: { maxLength: 20 } } });
    r.define({ name: "x", mixins: ["tweaked"], fields: { id: { type: "integer" } } });
    expect(r.getModel("x").fields.v).toMatchObject({ type: "char", maxLength: 20 });
    // Abstract models are validated on their own, so an override-only field with nothing to override is an error:
    expect(() => r.define({ name: "orphan_tweak", abstract: true, fields: { v: { maxLength: 20 } } })).toThrow(
      /Model "orphan_tweak", field "v": Field definition requires a `type`/
    );
  });

  it("compose: a mixin can use mixins, and concrete models can be mixed in too (fields only)", () => {
    const r = registry();
    r.define(stamped);
    r.define({ name: "audited", abstract: true, mixins: ["stamped"], fields: { by: { type: "char" } } });
    r.define({ name: "invoice", mixins: ["audited"], fields: { id: { type: "integer" } } });
    r.define({ name: "credit_note", mixins: ["invoice"], fields: { reason: { type: "char" } } });
    expect(Object.keys(r.getModel("invoice").fields)).toEqual(["createdAt", "updatedAt", "by", "id"]);
    expect(Object.keys(r.getModel("credit_note").fields)).toEqual(["createdAt", "updatedAt", "by", "id", "reason"]);
    expect(r.getModel("credit_note").tableName).toBe("credit_note"); // not invoice's
  });

  it("can carry relations and computed fields", () => {
    const r = registry();
    r.define({
      name: "owned",
      abstract: true,
      fields: { ownerId: { type: "integer" }, label: { type: "char", depends: ["ownerId"], compute: (rec) => `#${rec.ownerId}` } },
      relations: { owner: { type: "belongsTo", model: "user", foreignKey: "ownerId" } },
    });
    r.define({ name: "doc", mixins: ["owned"], fields: { id: { type: "integer" } } });
    expect(Object.keys(r.getModel("doc").relations)).toEqual(["owner"]);
    expect(Object.keys(r.getModel("doc").computed)).toEqual(["label"]);
  });

  it("an extension can also mix things in, applied before its own fields", () => {
    const r = registry();
    r.define(stamped);
    r.define(post());
    r.define({ extend: "post", mixins: ["stamped"], fields: { extra: { type: "char" } } });
    expect(Object.keys(r.getModel("post").fields)).toEqual(["id", "title", "createdAt", "updatedAt", "extra"]);
  });

  it("propagate later changes to a mixin into every model that uses it", () => {
    const r = registry();
    r.define(stamped);
    r.define({ name: "a", mixins: ["stamped"], fields: { id: { type: "integer" } } });
    r.define({ name: "b", mixins: ["stamped"], fields: { id: { type: "integer" } } });
    r.define({ extend: "stamped", fields: { deletedAt: { type: "datetime" } } });
    expect(Object.keys(r.getModel("a").fields)).toContain("deletedAt");
    expect(Object.keys(r.getModel("b").fields)).toContain("deletedAt");
  });

  it("reject a change to a mixin that would break a model using it, changing nothing", () => {
    const r = registry();
    r.define(stamped);
    r.define({ name: "invoice", mixins: ["stamped"], fields: { id: { type: "integer" }, total: { type: "float" } } });
    const before = r.getModel("invoice");
    expect(() => r.define({ extend: "stamped", fields: { total: { type: "char" } } }, { origin: "clash" })).toThrow(
      /Model "invoice" \(which mixes in "stamped"\) would no longer be valid/
    );
    expect(r.getModel("invoice")).toBe(before);
    expect(Object.keys(r.getModel("invoice").fields)).toEqual(["createdAt", "updatedAt", "id", "total"]);
  });

  it("detect cycles", () => {
    const r = registry();
    r.define({ name: "a", abstract: true, fields: { x: { type: "char" } } });
    r.define({ name: "b", abstract: true, mixins: ["a"], fields: { y: { type: "char" } } });
    expect(() => r.define({ extend: "a", mixins: ["b"] })).toThrow(/Circular mixins: a -> b -> a/);
    expect(() => r.define({ name: "c", mixins: ["c"], fields: { i: { type: "integer" } } })).toThrow(/can't mix in itself/);
  });

  it("validate their own fields when defined, not only when first used", () => {
    expect(() => registry().define({ name: "m", abstract: true, fields: { v: { type: "nope" } } })).toThrow();
    expect(() => registry().define({ name: "m", abstract: true, table: "t", fields: { v: { type: "char" } } })).toThrow(/abstract, so it has no table/);
  });

  it("validate `mixins` itself", () => {
    expect(() => registry().define({ name: "x", mixins: "a", fields: { i: { type: "integer" } } })).toThrow(/array of model names/);
    expect(() => registry().define({ name: "x", mixins: ["a", "a"], fields: { i: { type: "integer" } } })).toThrow(/more than once/);
  });
});

describe("existing registry rules still hold", () => {
  it("rejects a duplicate model name, a reserved table prefix, and a shared table", () => {
    const r = registry();
    r.define(post());
    expect(() => r.define(post())).toThrow(ModelConflictError);
    expect(() => r.define({ name: "x", table: "_meta_thing", fields: { id: { type: "integer" } } })).toThrow(/reserved prefix/);
    expect(() => r.define({ name: "other", table: "post", fields: { id: { type: "integer" } } })).toThrow(/already used by model "post"/);
  });

  it("rejects a duplicate name even while the first is still waiting on a mixin", () => {
    const r = registry();
    r.define({ name: "invoice", mixins: ["stamped"], fields: { id: { type: "integer" } } });
    expect(() => r.define({ name: "invoice", fields: { id: { type: "integer" } } })).toThrow(/already registered/);
  });

  it("still validates a plain definition the way defineModel does", () => {
    expect(() => registry().define(null)).toThrow(/must be an object/);
    expect(() => registry().define({ fields: { id: { type: "integer" } } })).toThrow(/non-empty `name`/);
    expect(() => registry().define({ name: "x", fields: {} })).toThrow(/non-empty `fields`/);
  });

  it("returns the descriptor from define() as before", () => {
    const r = registry();
    expect(r.define(post())).toBe(r.getModel("post"));
  });
});
