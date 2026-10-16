import { describe, it, expect } from "vitest";
import { defineModel } from "../../../src/models/define-model.js";
import { mapFilterToColumns } from "../../../src/crud/map-filter.js";
import { ValidationError } from "../../../src/crud/errors.js";

const model = defineModel({
  name: "invoice",
  fields: {
    id: { type: "integer", required: true },
    customerId: { type: "integer", required: true },
  },
});

describe("mapFilterToColumns", () => {
  it("renames field-name keys to column-name keys", () => {
    expect(mapFilterToColumns(model, { customerId: 5 })).toEqual({ customer_id: 5 });
  });

  it("casts filter values through the field's type", () => {
    expect(mapFilterToColumns(model, { id: "5" })).toEqual({ id: 5 });
  });

  it("passes null through without casting", () => {
    expect(mapFilterToColumns(model, { customerId: null })).toEqual({ customer_id: null });
  });

  it("throws ValidationError for an unknown field", () => {
    expect(() => mapFilterToColumns(model, { typo: 1 })).toThrow(ValidationError);
  });
});
