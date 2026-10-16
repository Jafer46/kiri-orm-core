import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { expandGlobs, globToRegExp } from "../../../src/global/glob.js";

describe("globToRegExp", () => {
  const matches = (glob, path) => globToRegExp(glob).test(path);

  it("* stays within one path segment, ** crosses them", () => {
    expect(matches("/a/*.js", "/a/x.js")).toBe(true);
    expect(matches("/a/*.js", "/a/b/x.js")).toBe(false);
    expect(matches("/a/**/x.js", "/a/b/c/x.js")).toBe(true);
  });

  it("**/ also matches zero directories", () => {
    expect(matches("/a/**/x.js", "/a/x.js")).toBe(true);
  });

  it("? matches exactly one non-slash character", () => {
    expect(matches("/a/?.js", "/a/x.js")).toBe(true);
    expect(matches("/a/?.js", "/a/xy.js")).toBe(false);
  });

  it("{a,b} alternatives, including nested", () => {
    expect(matches("/a/*.{model,schema}.js", "/a/u.schema.js")).toBe(true);
    expect(matches("/a/*.{model,schema}.js", "/a/u.other.js")).toBe(false);
    expect(matches("/a/{x,y{1,2}}.js", "/a/y2.js")).toBe(true);
  });

  it("treats regex metacharacters in the pattern literally", () => {
    expect(matches("/a/b.js", "/a/bxjs")).toBe(false);
    expect(matches("/a/(x).js", "/a/(x).js")).toBe(true);
  });

  it("rejects an unbalanced brace", () => {
    expect(() => globToRegExp("/a/{x,y.js")).toThrow(/unbalanced/);
  });
});

describe("expandGlobs", () => {
  let root;
  const rel = (files) => files.map((f) => relative(root, f).replace(/\\/g, "/"));

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "orm-glob-"));
    const files = [
      "src/user.model.js",
      "src/post.model.js",
      "src/post.test.js",
      "src/deep/tag.model.js",
      "src/helper.js",
      "node_modules/pkg/x.model.js",
      ".hidden/y.model.js",
    ];
    for (const file of files) {
      await mkdir(join(root, file, ".."), { recursive: true });
      await writeFile(join(root, file), "");
    }
  });
  afterAll(() => rm(root, { recursive: true, force: true }));

  it("finds matching files, sorted, as absolute paths", async () => {
    const files = await expandGlobs(["./src/**/*.model.js"], root);
    expect(rel(files)).toEqual(["src/deep/tag.model.js", "src/post.model.js", "src/user.model.js"]);
    expect(files.every((f) => f.startsWith("/") || /^[A-Za-z]:/.test(f))).toBe(true);
  });

  it("never descends into node_modules or dot-directories", async () => {
    const files = await expandGlobs(["**/*.model.js"], root);
    expect(rel(files).some((f) => f.includes("node_modules") || f.includes(".hidden"))).toBe(false);
  });

  it("a !pattern removes earlier matches", async () => {
    const files = await expandGlobs(["./src/*.js", "!./src/*.test.js", "!**/helper.js"], root);
    expect(rel(files)).toEqual(["src/post.model.js", "src/user.model.js"]);
  });

  it("a pattern with no glob characters names a single file", async () => {
    expect(rel(await expandGlobs(["./src/helper.js"], root))).toEqual(["src/helper.js"]);
  });

  it("de-duplicates files matched by several patterns", async () => {
    const files = await expandGlobs(["./src/*.model.js", "./src/user.model.js"], root);
    expect(rel(files)).toEqual(["src/post.model.js", "src/user.model.js"]);
  });

  it("returns nothing, rather than throwing, for a base directory that doesn't exist", async () => {
    expect(await expandGlobs(["./nope/**/*.js"], root)).toEqual([]);
  });
});
