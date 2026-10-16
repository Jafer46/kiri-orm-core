import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { connect, getConnection, disconnect } from "../../../src/global/connect.js";
import { __resetGlobalStateForTests } from "../../../src/global/state.js";
import { createConnection } from "../../../src/connection.js";

describe("connect/getConnection/disconnect", () => {
  beforeEach(() => {
    __resetGlobalStateForTests();
  });

  afterEach(async () => {
    await disconnect();
    __resetGlobalStateForTests();
  });

  it("throws a clear error from getConnection() before connect() is called", () => {
    expect(() => getConnection()).toThrow(/call connect/);
  });

  it("connect() with a config builds and stores a connection retrievable via getConnection()", () => {
    const db = connect({ dialect: "sqlite", filename: ":memory:" });
    expect(getConnection()).toBe(db);
  });

  it("connect() accepts an already-built Knex instance directly", () => {
    const prebuilt = createConnection({ dialect: "sqlite", filename: ":memory:" });
    const returned = connect(prebuilt);
    expect(returned).toBe(prebuilt);
    expect(getConnection()).toBe(prebuilt);
  });

  it("disconnect() clears the stored connection, so getConnection() throws again", async () => {
    connect({ dialect: "sqlite", filename: ":memory:" });
    await disconnect();
    expect(() => getConnection()).toThrow(/call connect/);
  });

  it("disconnect() is a no-op when nothing is connected", async () => {
    await expect(disconnect()).resolves.toBeUndefined();
  });
});
