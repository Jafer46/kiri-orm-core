import { describe, it, expect } from "vitest";
import { createConnection, DIALECTS } from "../../src/index.js";

describe("createConnection - validation", () => {
  it("exposes the supported dialects list", () => {
    expect(DIALECTS).toEqual(["sqlite", "postgres"]);
  });

  it("throws when config is missing", () => {
    expect(() => createConnection(undefined)).toThrow(/dialect/i);
  });

  it("throws on an unsupported dialect", () => {
    expect(() => createConnection({ dialect: "mysql" })).toThrow(/dialect/i);
  });

  it("throws when postgres is missing a connectionString", () => {
    expect(() => createConnection({ dialect: "postgres" })).toThrow(
      /connectionString/i
    );
  });

  it("creates a sqlite connection with a default in-memory filename", () => {
    const db = createConnection({ dialect: "sqlite" });
    expect(db.client.config.connection.filename).toBe(":memory:");
    return db.destroy();
  });
});
