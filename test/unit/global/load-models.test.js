import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadModels } from "../../../src/global/load-models.js";
import { getDefaultModelRegistry } from "../../../src/global/migrate.js";
import { __resetGlobalStateForTests } from "../../../src/global/state.js";

// Fixture files live in a temp dir, so they can't resolve "@kiri-orm/core" by name; they import
// this checkout's entry point by URL instead - the same module instance the test itself uses.
const CORE = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), "../../../src/index.js"),
).href;

describe("loadModels", () => {
  let dir;

  const write = async (path, source) => {
    await mkdir(join(dir, path, ".."), { recursive: true });
    await writeFile(join(dir, path), source);
  };
  const modelFile = (name, extra = "") =>
    `import { createModel } from "${CORE}";\nexport const M = createModel("${name}", { fields: { id: { type: "integer", required: true } }${extra} });\n`;

  beforeEach(async () => {
    __resetGlobalStateForTests();
    dir = await mkdtemp(join(tmpdir(), "orm-load-"));
  });
  afterEach(async () => {
    __resetGlobalStateForTests();
    await rm(dir, { recursive: true, force: true });
  });

  it("imports every matching file, registering its models into the default registry", async () => {
    await write("a/user.model.js", modelFile("user"));
    await write("a/deep/post.model.js", modelFile("post"));
    await write("a/ignored.js", modelFile("ignored"));

    const files = await loadModels("./a/**/*.model.js", { cwd: dir });

    expect(files).toHaveLength(2);
    expect(getDefaultModelRegistry().listModels().sort()).toEqual([
      "post",
      "user",
    ]);
  });

  it("doesn't depend on file order: a relation target, extension or mixin may load later", async () => {
    await write(
      "m/a-order.model.js",
      `import { createModel } from "${CORE}";
createModel("order", {
  fields: { id: { type: "integer", required: true }, customerId: { type: "integer" } },
  relations: { customer: { type: "belongsTo", model: "customer", foreignKey: "customerId" } },
});
`,
    );
    await write(
      "m/b-ext.model.js",
      `import { extendModel } from "${CORE}";\nextendModel("customer", { fields: { nickname: { type: "char" } } });\n`,
    );
    await write("m/c-customer.model.js", modelFile("customer"));

    await loadModels("./m/*.js", { cwd: dir });

    const registry = getDefaultModelRegistry();
    registry.assertResolved();
    expect(Object.keys(registry.getModel("customer").fields)).toContain(
      "nickname",
    );
  });

  it("accepts an array of patterns including exclusions", async () => {
    await write("x/one.js", modelFile("one"));
    await write("x/two.js", modelFile("two"));
    await write(
      "x/index.js",
      `export * from "./one.js";\nexport * from "./two.js";\n`,
    );

    await loadModels(["./x/*.js", "!./x/index.js"], { cwd: dir });

    expect(getDefaultModelRegistry().listModels().sort()).toEqual([
      "one",
      "two",
    ]);
  });

  it("is idempotent: loading the same files again defines nothing twice", async () => {
    await write("i/user.js", modelFile("user"));
    await loadModels("./i/*.js", { cwd: dir });
    await expect(loadModels("./i/*.js", { cwd: dir })).resolves.toHaveLength(1);
    expect(getDefaultModelRegistry().listModels()).toEqual(["user"]);
  });

  it("throws when nothing matches, naming the pattern - unless allowEmpty", async () => {
    await expect(loadModels("./nothing/*.js", { cwd: dir })).rejects.toThrow(
      /no files matched "\.\/nothing\/\*\.js"/,
    );
    await expect(
      loadModels("./nothing/*.js", { cwd: dir, allowEmpty: true }),
    ).resolves.toEqual([]);
  });

  it("names the file that failed to load, and keeps the original error as the cause", async () => {
    await write("bad/broken.js", `throw new Error("boom");\n`);
    const error = await loadModels("./bad/*.js", { cwd: dir }).catch((e) => e);
    expect(error.message).toMatch(
      /could not load model file .*broken\.js: boom/,
    );
    expect(error.cause.message).toBe("boom");
  });

  it("rejects an empty or non-string pattern", async () => {
    await expect(loadModels([], { cwd: dir })).rejects.toThrow(TypeError);
    await expect(loadModels("", { cwd: dir })).rejects.toThrow(TypeError);
    await expect(loadModels(42, { cwd: dir })).rejects.toThrow(TypeError);
  });
});
