import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * A deliberately small glob matcher so that discovering model files needs no
 * dependency (core's only runtime dependency is knex). Supported syntax:
 *
 *   *        any characters except "/"
 *   **       any characters including "/"  ("**\/" also matches zero directories)
 *   ?        one character except "/"
 *   {a,b}    alternatives (may be nested)
 *   !prefix  a pattern starting with "!" removes matches from the earlier ones
 *
 * Always use forward slashes, on Windows too. Directories named `node_modules`
 * and directories starting with "." are never descended into.
 */

const GLOB_CHARS = /[*?{]/;
const SKIPPED_DIRECTORIES = (name) => name === "node_modules" || name.startsWith(".");

/** @param {string} glob an absolute, forward-slash pattern */
export function globToRegExp(glob) {
  let source = "";
  let braceDepth = 0;
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          source += "(?:.*/)?"; // "**/" - zero or more directories
          i += 2;
        } else {
          source += ".*";
          i += 1;
        }
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else if (char === "{") {
      source += "(?:";
      braceDepth++;
    } else if (char === "}" && braceDepth > 0) {
      source += ")";
      braceDepth--;
    } else if (char === "," && braceDepth > 0) {
      source += "|";
    } else {
      source += char.replace(/[.+^$()|\\[\]{}]/g, "\\$&");
    }
  }
  if (braceDepth !== 0) throw new TypeError(`Invalid glob "${glob}": unbalanced "{"`);
  return new RegExp(`^${source}$`);
}

/** The part of an absolute pattern before the first segment containing a glob character. */
function staticBase(pattern) {
  const segments = pattern.split("/");
  const fixed = [];
  for (const segment of segments) {
    if (GLOB_CHARS.test(segment)) break;
    fixed.push(segment);
  }
  // A pattern with no glob characters at all names one file: its "base" is the whole path.
  return fixed.length === segments.length ? pattern : fixed.join("/") || "/";
}

async function* walk(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return;
    throw error;
  }
  for (const entry of entries) {
    const path = `${directory.replace(/\/$/, "")}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES(entry.name)) yield* walk(path);
    } else if (entry.isFile()) {
      yield path;
    }
  }
}

const toAbsolute = (pattern, cwd) => resolve(cwd, pattern.replace(/\\/g, "/")).replace(/\\/g, "/");

/**
 * Expands glob patterns to the files they match: absolute paths, sorted, no duplicates.
 * Relative patterns are resolved against `cwd`. A `!pattern` removes files matched by
 * the patterns before it.
 *
 * @param {string[]} patterns
 * @param {string} cwd
 * @returns {Promise<string[]>}
 */
export async function expandGlobs(patterns, cwd) {
  const found = new Set();
  for (const raw of patterns) {
    const negated = raw.startsWith("!");
    const pattern = toAbsolute(negated ? raw.slice(1) : raw, cwd);
    const matcher = globToRegExp(pattern);

    if (negated) {
      for (const file of found) if (matcher.test(file)) found.delete(file);
      continue;
    }

    const base = staticBase(pattern);
    const info = await stat(base).catch(() => null);
    if (info?.isFile()) {
      if (matcher.test(base)) found.add(base);
    } else if (info?.isDirectory()) {
      for await (const file of walk(base)) if (matcher.test(file)) found.add(file);
    }
  }
  return [...found].sort();
}
