import { describe, it, expect } from "vitest";
import { defineRelation } from "../../../src/relations/define-relation.js";
import { InvalidRelationDefinitionError } from "../../../src/relations/errors.js";

describe("defineRelation", () => {
  it("defines a belongsTo relation with defaults", () => {
    const rel = defineRelation({ type: "belongsTo", model: "invoice", foreignKey: "invoiceId" });
    expect(rel.type).toBe("belongsTo");
    expect(rel.model).toBe("invoice");
    expect(rel.foreignKey).toBe("invoiceId");
    expect(rel.localKey).toBe("id"); // default
  });

  it("defines a hasMany relation", () => {
    const rel = defineRelation({ type: "hasMany", model: "invoiceLine", foreignKey: "invoiceId" });
    expect(rel.type).toBe("hasMany");
  });

  it("defines a hasOne relation", () => {
    const rel = defineRelation({ type: "hasOne", model: "profile", foreignKey: "userId" });
    expect(rel.type).toBe("hasOne");
  });

  it("defines a belongsToMany relation requiring through/foreignKey/otherKey", () => {
    const rel = defineRelation({
      type: "belongsToMany",
      model: "tag",
      through: "invoice_tag",
      foreignKey: "invoice_id",
      otherKey: "tag_id",
    });
    expect(rel.through).toBe("invoice_tag");
    expect(rel.otherKey).toBe("tag_id");
  });

  it("allows an explicit localKey override", () => {
    const rel = defineRelation({
      type: "belongsTo",
      model: "invoice",
      foreignKey: "invoiceCode",
      localKey: "code",
    });
    expect(rel.localKey).toBe("code");
  });

  it("returns a frozen object", () => {
    const rel = defineRelation({ type: "belongsTo", model: "invoice", foreignKey: "invoiceId" });
    expect(Object.isFrozen(rel)).toBe(true);
  });

  it("throws for an unknown type", () => {
    expect(() => defineRelation({ type: "hasMillions", model: "x", foreignKey: "y" })).toThrow(
      InvalidRelationDefinitionError
    );
  });

  it("throws when model is missing", () => {
    expect(() => defineRelation({ type: "belongsTo", foreignKey: "x" })).toThrow(
      InvalidRelationDefinitionError
    );
  });

  it("throws when foreignKey is missing for belongsTo/hasOne/hasMany", () => {
    expect(() => defineRelation({ type: "belongsTo", model: "invoice" })).toThrow(
      InvalidRelationDefinitionError
    );
    expect(() => defineRelation({ type: "hasMany", model: "invoiceLine" })).toThrow(
      InvalidRelationDefinitionError
    );
  });

  it("throws when belongsToMany is missing through/foreignKey/otherKey", () => {
    expect(() => defineRelation({ type: "belongsToMany", model: "tag" })).toThrow(
      InvalidRelationDefinitionError
    );
    expect(() =>
      defineRelation({ type: "belongsToMany", model: "tag", through: "invoice_tag" })
    ).toThrow(InvalidRelationDefinitionError);
  });
});
