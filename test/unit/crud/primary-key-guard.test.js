import { describe, it, expect } from "vitest";
import { defineModel } from "../../../src/models/define-model.js";
import { assertPrimaryKeyUntouched } from "../../../src/crud/prepare-write.js";
import { ValidationError } from "../../../src/crud/errors.js";

const post = defineModel({ name: "post", fields: { id: { type: "integer" }, title: { type: "char" } } });

describe("assertPrimaryKeyUntouched", () => {
  it("passes when the data leaves the primary key alone", () => {
    expect(() => assertPrimaryKeyUntouched(post, { title: "x" })).not.toThrow();
  });

  it("throws a ValidationError keyed by the primary key field when it is present", () => {
    let error;
    try {
      assertPrimaryKeyUntouched(post, { id: 5, title: "x" });
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(ValidationError);
    expect(Object.keys(error.fieldErrors)).toEqual(["id"]);
    expect(error.fieldErrors.id[0]).toMatch(/primary key of model "post"/);
  });

  it("treats a key set to undefined or to its current value the same: still rejected", () => {
    expect(() => assertPrimaryKeyUntouched(post, { id: undefined })).toThrow(ValidationError);
    expect(() => assertPrimaryKeyUntouched(post, { id: 1 })).toThrow(ValidationError);
  });

  it("follows a custom primary key, and leaves an `id` field that isn't the key alone", () => {
    const code = defineModel({
      name: "country",
      primaryKey: "code",
      fields: { code: { type: "char", required: true }, id: { type: "integer" } },
    });
    expect(() => assertPrimaryKeyUntouched(code, { id: 3 })).not.toThrow();
    expect(() => assertPrimaryKeyUntouched(code, { code: "ET" })).toThrow(ValidationError);
  });

  it("applies to keys that aren't auto-assigned too (natural keys are immutable as well)", () => {
    const manual = defineModel({ name: "manual", fields: { id: { type: "integer", required: true, auto: false } } });
    expect(() => assertPrimaryKeyUntouched(manual, { id: 2 })).toThrow(ValidationError);
  });

  it("does nothing for a model with no primary key", () => {
    const keyless = defineModel({ name: "log", fields: { message: { type: "char" } } });
    expect(() => assertPrimaryKeyUntouched(keyless, { message: "x" })).not.toThrow();
  });
});
