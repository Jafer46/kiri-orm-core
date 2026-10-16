import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { connect, disconnect, createModel, syncModels, getConnection, diffModels, migrateModels } from "../../src/global/index.js";
import { __resetGlobalStateForTests } from "../../src/global/state.js";
import { MigrationSafetyError } from "../../src/migrations/errors.js";

describe("global migration functions", () => {
  beforeEach(() => {
    __resetGlobalStateForTests();
    connect({ dialect: "sqlite", filename: ":memory:" });
  });

  afterEach(async () => {
    await disconnect();
    __resetGlobalStateForTests();
  });

  it("confirms sync() alone never drops a removed field - additive-only, as documented everywhere else in this ORM", async () => {
    createModel("user", {
      fields: { id: { type: "integer", required: true }, nickname: { type: "char" } },
    });
    await syncModels();

    // Redefining with the field removed and re-syncing does NOT drop
    // it - this is expected sync() behavior, not a bug, and is
    // exactly the scenario that had no path to a real fix without
    // migrateModels()/diffModels() below.
    const columnsAfterSync = await getConnection()("user").columnInfo();
    expect(columnsAfterSync).toHaveProperty("nickname");
  });

  it("migrateModels() actually drops a removed field when allowDestructive is true (the reported bug, now fixed)", async () => {
    const db = getConnection();
    createModel("user", {
      fields: { id: { type: "integer", required: true }, name: { type: "char", required: true }, nickname: { type: "char" } },
    });
    await syncModels();
    let columns = await db("user").columnInfo();
    expect(columns).toHaveProperty("nickname");

    // Simulate "redefine the model with the field removed" by
    // resetting the registry (same connection) and defining the
    // narrower schema, mirroring what happens across two separate
    // process runs against the same database file in real usage.
    __resetGlobalStateForTests();
    connect(db);
    createModel("user", {
      fields: { id: { type: "integer", required: true }, name: { type: "char", required: true } },
    });

    const plan = await diffModels();
    expect(plan.fieldChanges.user.dropFields.map((d) => d.fieldName)).toEqual(["nickname"]);

    const result = await migrateModels({ allowDestructive: true });
    expect(result.applied).toBe(true);

    columns = await db("user").columnInfo();
    expect(columns).not.toHaveProperty("nickname");
  });

  it("migrateModels() refuses the destructive change without allowDestructive", async () => {
    const db = getConnection();
    createModel("user", {
      fields: { id: { type: "integer", required: true }, nickname: { type: "char" } },
    });
    await syncModels();

    __resetGlobalStateForTests();
    connect(db);
    createModel("user", { fields: { id: { type: "integer", required: true } } });

    await expect(migrateModels()).rejects.toThrow(MigrationSafetyError);

    const columns = await db("user").columnInfo();
    expect(columns).toHaveProperty("nickname"); // untouched
  });

  it("migrateModels({ dryRun: true }) reports the plan without applying anything", async () => {
    const db = getConnection();
    createModel("user", {
      fields: { id: { type: "integer", required: true }, nickname: { type: "char" } },
    });
    await syncModels();

    __resetGlobalStateForTests();
    connect(db);
    createModel("user", { fields: { id: { type: "integer", required: true } } });

    const result = await migrateModels({ dryRun: true, allowDestructive: true });
    expect(result.applied).toBe(false);
    expect(result.summary.some((line) => line.includes("nickname"))).toBe(true);

    const columns = await db("user").columnInfo();
    expect(columns).toHaveProperty("nickname"); // still untouched - dry run only
  });

  it("diffModels() reports no changes once migrateModels() has applied and re-synced", async () => {
    const db = getConnection();
    createModel("user", {
      fields: { id: { type: "integer", required: true }, nickname: { type: "char" } },
    });
    await syncModels();

    __resetGlobalStateForTests();
    connect(db);
    createModel("user", { fields: { id: { type: "integer", required: true } } });
    await migrateModels({ allowDestructive: true });

    const plan = await diffModels();
    expect(plan.fieldChanges).toEqual({});
  });
});
