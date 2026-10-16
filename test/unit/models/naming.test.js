import { describe, it, expect } from "vitest";
import {
  toSnakeCase,
  toCamelCase,
  defaultNamingStrategy,
  identityNamingStrategy,
} from "../../../src/models/naming.js";

describe("toSnakeCase", () => {
  it("converts simple camelCase", () => {
    expect(toSnakeCase("customerId")).toBe("customer_id");
  });

  it("converts PascalCase", () => {
    expect(toSnakeCase("OrderLine")).toBe("order_line");
  });

  it("handles acronyms sensibly", () => {
    expect(toSnakeCase("userID")).toBe("user_id");
  });

  it("leaves already-snake_case strings unchanged", () => {
    expect(toSnakeCase("already_snake")).toBe("already_snake");
  });

  it("leaves a single lowercase word unchanged", () => {
    expect(toSnakeCase("invoice")).toBe("invoice");
  });
});

describe("toCamelCase", () => {
  it("converts simple snake_case", () => {
    expect(toCamelCase("customer_id")).toBe("customerId");
  });

  it("converts multi-word snake_case", () => {
    expect(toCamelCase("order_line_item")).toBe("orderLineItem");
  });

  it("leaves already-camelCase strings unchanged", () => {
    expect(toCamelCase("alreadyCamel")).toBe("alreadyCamel");
  });

  it("round-trips through both conversions", () => {
    expect(toCamelCase(toSnakeCase("customerId"))).toBe("customerId");
  });
});

describe("defaultNamingStrategy", () => {
  it("converts model names to snake_case table names", () => {
    expect(defaultNamingStrategy.modelToTable("invoiceLine")).toBe("invoice_line");
  });

  it("converts field names to snake_case column names", () => {
    expect(defaultNamingStrategy.fieldToColumn("customerId")).toBe("customer_id");
  });

  it("does not pluralize table names", () => {
    expect(defaultNamingStrategy.modelToTable("invoice")).toBe("invoice");
  });
});

describe("identityNamingStrategy", () => {
  it("passes model and field names through unchanged", () => {
    expect(identityNamingStrategy.modelToTable("Invoice")).toBe("Invoice");
    expect(identityNamingStrategy.fieldToColumn("customerId")).toBe("customerId");
  });
});
