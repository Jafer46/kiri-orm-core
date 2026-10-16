import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { connect, disconnect, createModel, generateModelDTOs, generateAllModelDTOs, generateModelJSDoc } from "../../src/global/index.js";
import { __resetGlobalStateForTests } from "../../src/global/state.js";

describe("global DTO generation wrappers", () => {
  beforeEach(() => {
    __resetGlobalStateForTests();
    connect({ dialect: "sqlite", filename: ":memory:" });
  });

  afterEach(async () => {
    await disconnect();
    __resetGlobalStateForTests();
  });

  it("generateModelDTOs() works against a model created via createModel()", () => {
    createModel("user", {
      fields: { id: { type: "integer", required: true }, name: { type: "char", required: true } },
    });

    const dtos = generateModelDTOs("user");
    expect(dtos.create.title).toBe("CreateUser");
    expect(dtos.create.required).toEqual(["name"]);
    expect(dtos.read.properties).toHaveProperty("id");
  });

  it("generateAllModelDTOs() covers every registered model", () => {
    createModel("user", { fields: { id: { type: "integer", required: true } } });
    createModel("post", { fields: { id: { type: "integer", required: true } } });

    const all = generateAllModelDTOs();
    expect(Object.keys(all).sort()).toEqual(["post", "user"]);
  });

  it("generateModelJSDoc() returns typedefs for every registered model", () => {
    createModel("user", {
      fields: { id: { type: "integer", required: true }, name: { type: "char", required: true } },
    });

    const output = generateModelJSDoc();
    expect(output).toContain("@typedef {Object} CreateUser");
    expect(output).toContain("@typedef {Object} ReadUser");
  });

  it("exit criteria: DTOs reflect a changed model definition with no manual sync step, across two 'sessions'", async () => {
    createModel("user", {
      fields: { id: { type: "integer", required: true }, name: { type: "char", required: true } },
    });
    const dtosV1 = generateModelDTOs("user");
    expect(dtosV1.create.properties).not.toHaveProperty("nickname");

    // Mirrors real usage: the model definition changed (a field was
    // added) and the process restarted - not a special "resync DTOs"
    // step, just calling the generator again against whatever's
    // currently registered.
    __resetGlobalStateForTests();
    connect({ dialect: "sqlite", filename: ":memory:" });
    createModel("user", {
      fields: {
        id: { type: "integer", required: true },
        name: { type: "char", required: true },
        nickname: { type: "char" },
      },
    });
    const dtosV2 = generateModelDTOs("user");

    expect(dtosV2.create.properties).toHaveProperty("nickname");
  });
});
