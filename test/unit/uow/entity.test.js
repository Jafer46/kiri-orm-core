import { describe, it, expect } from "vitest";
import { defineModel } from "../../../src/models/define-model.js";
import { createEntity, diffEntity, ENTITY_META } from "../../../src/uow/entity.js";

const model = defineModel({
  name: "invoice",
  fields: {
    id: { type: "integer", required: true },
    status: { type: "enum", values: ["draft", "paid"] },
    total: { type: "float" },
    dueDate: { type: "date" },
    metadata: { type: "json" },
  },
});

function makeEntity(record) {
  // unitOfWork arg is unused by createEntity except to bind save()/delete(),
  // which these pure tests never call - a stub object is fine.
  return createEntity(record, model, "invoice", {});
}

describe("createEntity", () => {
  it("copies the record's fields onto the entity", () => {
    const entity = makeEntity({ id: 1, status: "draft", total: 100 });
    expect(entity.id).toBe(1);
    expect(entity.status).toBe("draft");
    expect(entity.total).toBe(100);
  });

  it("hides entity metadata from Object.keys()", () => {
    const entity = makeEntity({ id: 1, status: "draft" });
    expect(Object.keys(entity)).toEqual(["id", "status"]);
  });

  it("hides entity metadata from JSON.stringify()", () => {
    const entity = makeEntity({ id: 1, status: "draft" });
    expect(JSON.parse(JSON.stringify(entity))).toEqual({ id: 1, status: "draft" });
  });

  it("attaches non-enumerable save() and delete() methods", () => {
    const entity = makeEntity({ id: 1 });
    expect(typeof entity.save).toBe("function");
    expect(typeof entity.delete).toBe("function");
    expect(Object.keys(entity)).not.toContain("save");
    expect(Object.keys(entity)).not.toContain("delete");
  });

  it("captures an independent original snapshot (mutating the record after doesn't affect it)", () => {
    const record = { id: 1, status: "draft" };
    const entity = makeEntity(record);
    record.status = "paid"; // mutate the source record after entity creation
    expect(entity[ENTITY_META].original.status).toBe("draft");
  });
});

describe("diffEntity", () => {
  it("returns an empty object when nothing changed", () => {
    const entity = makeEntity({ id: 1, status: "draft", total: 100 });
    expect(diffEntity(entity, model)).toEqual({});
  });

  it("detects a single changed primitive field", () => {
    const entity = makeEntity({ id: 1, status: "draft", total: 100 });
    entity.status = "paid";
    expect(diffEntity(entity, model)).toEqual({ status: "paid" });
  });

  it("detects multiple changed fields", () => {
    const entity = makeEntity({ id: 1, status: "draft", total: 100 });
    entity.status = "paid";
    entity.total = 200;
    expect(diffEntity(entity, model)).toEqual({ status: "paid", total: 200 });
  });

  it("does not flag an unchanged date field as dirty even when reassigned to an equal-time new Date instance", () => {
    const original = new Date("2026-01-01T00:00:00.000Z");
    const entity = makeEntity({ id: 1, dueDate: original });
    entity.dueDate = new Date("2026-01-01T00:00:00.000Z"); // different object, same moment
    expect(diffEntity(entity, model)).toEqual({});
  });

  it("flags a date field as dirty when reassigned to a genuinely different moment", () => {
    const entity = makeEntity({ id: 1, dueDate: new Date("2026-01-01T00:00:00.000Z") });
    entity.dueDate = new Date("2026-02-01T00:00:00.000Z");
    expect(diffEntity(entity, model)).toEqual({ dueDate: entity.dueDate });
  });

  it("flags a date field as dirty when mutated in place (same object reference, different value)", () => {
    const entity = makeEntity({ id: 1, dueDate: new Date("2026-01-01T00:00:00.000Z") });
    entity.dueDate.setUTCMonth(5); // mutate in place - reference stays the same
    expect(diffEntity(entity, model)).toEqual({ dueDate: entity.dueDate });
  });

  it("does not flag an unchanged json field as dirty even when reassigned to a deeply-equal new object", () => {
    const entity = makeEntity({ id: 1, metadata: { tags: ["a", "b"] } });
    entity.metadata = { tags: ["a", "b"] }; // different object, same content
    expect(diffEntity(entity, model)).toEqual({});
  });

  it("flags a json field as dirty when mutated in place (same object reference, different content)", () => {
    const entity = makeEntity({ id: 1, metadata: { tags: ["a"] } });
    entity.metadata.tags.push("b"); // in-place mutation - reference unchanged, content changed
    expect(diffEntity(entity, model)).toEqual({ metadata: { tags: ["a", "b"] } });
  });

  it("ignores properties that aren't in model.fields (e.g. an eager-loaded relation)", () => {
    // Note: relations ARE copied onto the entity (see the next test) -
    // this test specifically checks diffEntity() itself ignores them
    // for dirty-tracking purposes, which is a separate concern from
    // whether they're visible on the entity at all.
    const entity = makeEntity({ id: 1, status: "draft" });
    entity.customer = { id: 5, name: "Acme" }; // not a field on this model
    expect(diffEntity(entity, model)).toEqual({});
  });
});

describe("createEntity - eager-loaded relations", () => {
  const modelWithRelations = defineModel({
    name: "invoice",
    fields: {
      id: { type: "integer", required: true },
      customerId: { type: "integer" },
    },
    relations: {
      customer: { type: "belongsTo", model: "customer", foreignKey: "customerId" },
      tags: { type: "belongsToMany", model: "tag", through: "invoice_tag", foreignKey: "invoice_id", otherKey: "tag_id" },
    },
  });

  it("copies eager-loaded relation values onto the entity (regression: these were silently dropped after the Date/JSON clone fix)", () => {
    const record = {
      id: 1,
      customerId: 5,
      customer: { id: 5, name: "Acme" }, // as attached by Repository's `with` option
      tags: [{ id: 1, name: "urgent" }],
    };
    const entity = createEntity(record, modelWithRelations, "invoice", {});
    expect(entity.customer).toEqual({ id: 5, name: "Acme" });
    expect(entity.tags).toEqual([{ id: 1, name: "urgent" }]);
  });

  it("relation values are not included in Object.keys() distinctly from fields - they behave like normal properties", () => {
    const record = { id: 1, customerId: 5, customer: { id: 5, name: "Acme" } };
    const entity = createEntity(record, modelWithRelations, "invoice", {});
    expect(Object.keys(entity).sort()).toEqual(["customer", "customerId", "id"]);
  });

  it("does not add a relation key at all when it wasn't eager-loaded (no `with` used)", () => {
    const record = { id: 1, customerId: 5 };
    const entity = createEntity(record, modelWithRelations, "invoice", {});
    expect("customer" in entity).toBe(false);
  });
});
