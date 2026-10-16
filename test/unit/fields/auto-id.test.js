import { describe, it, expect } from "vitest";
import { defineModel } from "../../../src/models/define-model.js";
import { defineField } from "../../../src/fields/define-field.js";
import { applyAutoIdDefault, isAutoId, AUTO_INCREMENT } from "../../../src/fields/auto-id.js";
import { uuidType } from "../../../src/fields/types/uuid.js";
import { defaultFor } from "../../../src/fields/default-for.js";

describe("uuid field type", () => {
  const field = defineField({ type: "uuid" });
  it("accepts any RFC 4122-shaped value, and lowercases on cast", () => {
    expect(uuidType.validate(field, "6A56DC83-83EE-4109-BBC4-B4301BF55F03")).toEqual([]);
    expect(uuidType.cast(field, "6A56DC83-83EE-4109-BBC4-B4301BF55F03")).toBe("6a56dc83-83ee-4109-bbc4-b4301bf55f03");
  });
  it("rejects anything else", () => {
    for (const bad of ["nope", "", 5, null, "6a56dc83-83ee-4109-bbc4-b4301bf55f0"]) {
      expect(uuidType.validate(field, bad)).toHaveLength(1);
    }
    expect(() => uuidType.cast(field, "nope")).toThrow(/cannot cast/);
  });
});

describe("isAutoId / applyAutoIdDefault", () => {
  const int = defineField({ type: "integer", required: true });
  const uuid = defineField({ type: "uuid", required: true });

  it("only a field literally named id, typed integer or uuid, qualifies", () => {
    expect(isAutoId("id", int)).toBe(true);
    expect(isAutoId("id", uuid)).toBe(true);
    expect(isAutoId("orderId", int)).toBe(false);
    expect(isAutoId("id", defineField({ type: "char" }))).toBe(false);
  });

  it("your own default, or auto: false, opts out", () => {
    expect(isAutoId("id", defineField({ type: "integer", default: 7 }))).toBe(false);
    expect(isAutoId("id", defineField({ type: "uuid", default: () => "x" }))).toBe(false);
    expect(isAutoId("id", defineField({ type: "integer", auto: false }))).toBe(false);
  });

  it("integer gets the sentinel, uuid a fresh value per call; both carry a JSON-safe autoId flag", () => {
    const i = applyAutoIdDefault("id", int);
    expect(defaultFor(i)).toBe(AUTO_INCREMENT);
    expect(i.autoId).toBe("increment");
    const u = applyAutoIdDefault("id", uuid);
    expect(defaultFor(u)).not.toBe(defaultFor(u));
    expect(defaultFor(u)).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(JSON.stringify(u)).autoId).toBe("uuid"); // survives serialization, unlike `default`
  });

  it("leaves a non-qualifying field untouched (same object)", () => {
    const other = defineField({ type: "char" });
    expect(applyAutoIdDefault("title", other)).toBe(other);
  });
});

describe("defineModel bakes it in", () => {
  it("makes an id optional to supply without touching other fields", () => {
    const model = defineModel({ name: "p", fields: { id: { type: "integer", required: true }, n: { type: "integer", required: true } } });
    expect(model.fields.id.default).toBe(AUTO_INCREMENT);
    expect(model.fields.n.default).toBeUndefined();
  });
});
