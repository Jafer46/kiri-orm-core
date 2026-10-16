/** @param {string} glob an absolute, forward-slash pattern */
export declare function globToRegExp(glob: string): RegExp;
/**
 * Expands glob patterns to the files they match: absolute paths, sorted, no duplicates.
 * Relative patterns are resolved against `cwd`. A `!pattern` removes files matched by
 * the patterns before it.
 *
 * @param {string[]} patterns
 * @param {string} cwd
 * @returns {Promise<string[]>}
 */
export declare function expandGlobs(patterns: string[], cwd: string): Promise<string[]>;
