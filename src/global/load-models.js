import { pathToFileURL } from "node:url";
import { expandGlobs } from "./glob.js";

/**
 * Imports every file matching `patterns`, for the side effect of each file's
 * `createModel()` / `extendModel()` / `defineMixin()` calls registering into the
 * default registry. This replaces the hand-written list of imports an app
 * otherwise keeps in its database setup file: a new model is a new file, and
 * nothing central has to be edited to know about it.
 *
 *   await loadModels("./src/**\/*.model.js");
 *   await loadModels(["./modules/*\/models/*.js", "!**\/*.test.js"]);
 *
 * Order doesn't matter - the registry already lets a model wait for a mixin, a
 * relation target or a base model that's defined later - so files are simply
 * imported in sorted order. Importing is idempotent: Node loads a file once, so
 * calling this again (or importing a model file by hand as well) never defines a
 * model twice.
 *
 * Relative patterns resolve against `cwd`, which defaults to the process's
 * working directory; pass `{ cwd: import.meta.dirname }` to anchor them to the
 * calling file instead. Patterns use forward slashes (see glob.js for the syntax).
 *
 * Throws if nothing matches (almost always a wrong path or pattern; pass
 * `{ allowEmpty: true }` to accept that) and names the file if one fails to load.
 *
 * @param {string|string[]} patterns
 * @param {{ cwd?: string, allowEmpty?: boolean }} [options]
 * @returns {Promise<string[]>} the files that were loaded (absolute paths)
 */
export async function loadModels(patterns, options = {}) {
  const { cwd = process.cwd(), allowEmpty = false } = options;
  const list = typeof patterns === "string" ? [patterns] : patterns;
  if (!Array.isArray(list) || list.length === 0 || list.some((p) => typeof p !== "string" || p.trim() === "")) {
    throw new TypeError("loadModels() expects a glob string or a non-empty array of glob strings");
  }

  const files = await expandGlobs(list, cwd);
  if (files.length === 0 && !allowEmpty) {
    throw new Error(`loadModels(): no files matched ${list.map((p) => `"${p}"`).join(", ")} (searched from ${cwd})`);
  }

  for (const file of files) {
    try {
      await import(pathToFileURL(file).href);
    } catch (error) {
      throw new Error(`loadModels(): could not load model file ${file}: ${error.message}`, { cause: error });
    }
  }
  return files;
}
