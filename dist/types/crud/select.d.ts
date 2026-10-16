/**
 * Field selection for `find({ select })`: which columns to read, and what has to ride
 * along so the result is still correct.
 *
 * Three things are kept apart on purpose:
 *
 * - what the caller ASKED for (`select`, validated by normalizeSelect());
 * - what that IMPLIES - a computed field can't be read without the stored fields it
 *   `depends` on (transitively, through other computed fields), so those are loaded
 *   too and appear on the record like any other selected field (expandSelect());
 * - what the ORM needs for ITS OWN bookkeeping - the join keys eager loading matches
 *   rows by. These are fetched too but are NOT part of the result unless asked for,
 *   so `select: ["title"]` with `with: ["author"]` doesn't leak `authorId`
 *   (planSelect().hidden, removed by stripHidden() once loading is done).
 */
/**
 * Validates `select` and returns it as a de-duplicated array of field names, or `null`
 * when there is no selection (meaning: every field, exactly as before `select` existed).
 * Stored and computed fields are both accepted.
 *
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {unknown} select
 * @returns {string[]|null}
 * @throws {ValidationError}
 */
export declare function normalizeSelect(model: import('../models/define-model.js').ModelDescriptor, select: unknown): string[] | null;
/**
 * Splits a validated selection into the stored fields to read and the computed fields to
 * define, following `depends` transitively: `fullName` depends on `firstName` and
 * `initials`, `initials` depends on `firstName` and `lastName` -> stored { firstName,
 * lastName }, computed { fullName, initials }.
 *
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {string[]} names - output of normalizeSelect()
 * @returns {{ fields: Set<string>, computed: Set<string> }}
 */
export declare function expandSelect(model: import('../models/define-model.js').ModelDescriptor, names: string[]): {
    fields: Set<string>;
    computed: Set<string>;
};
/**
 * Turns a (possibly absent) selection plus the join keys some relation needs into what
 * the query should read.
 *
 * - `columns`: column names to `select`, or `null` for "all columns" (no selection made;
 *   the SQL is then identical to what it was before `select` existed).
 * - `computed`: the computed fields to define on each record, or `null` for "all". A
 *   computed field whose dependencies weren't loaded would compute from `undefined`, so
 *   with a selection only the requested ones (and what they need) are defined.
 * - `hidden`: fields read only because `requiredKeys` needs them; strip them from the
 *   result with stripHidden() once whatever needed them is done.
 *
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {string[]|null} names - output of normalizeSelect()
 * @param {string[]} [requiredKeys] - stored fields that must be read regardless
 * @returns {{ columns: string[]|null, computed: Set<string>|null, hidden: string[] }}
 */
export declare function planSelect(model: import('../models/define-model.js').ModelDescriptor, names: string[] | null, requiredKeys?: string[]): {
    columns: string[] | null;
    computed: Set<string> | null;
    hidden: string[];
};
/** Removes fields that were read only for the ORM's own use (see planSelect().hidden). */
export declare function stripHidden(records: any, hidden: any): void;
/**
 * For the tracked APIs (`client.models.x.find`, global `Model.find`): a document needs its
 * primary key for `save()`, `delete()` and the identity map, so it is always read even if
 * `select` left it out. Plain `Repository.find` returns exactly what was asked for.
 *
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {object} [options] - find options
 * @returns {object} `options`, with the primary key added to `select` when needed
 */
export declare function withPrimaryKey(model: import('../models/define-model.js').ModelDescriptor, options?: object): object;
