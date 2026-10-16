/**
 * Odoo-style commands for writing a `hasMany` / `belongsToMany`
 * relation as part of a `create()` / `createMany()` payload:
 *
 *   await Post.createMany([
 *     {
 *       id: 1, title: "Hello",
 *       tags:     [Command.link(3), Command.link(4)],          // or simply [3, 4]
 *       comments: [Command.create({ id: 1, body: "First!" })],
 *     },
 *   ]);
 *
 * Commands are deliberately explicit (rather than "an array of plain
 * objects means create"): the same payload shape could otherwise mean
 * "create these" or "link to these existing records", and guessing
 * wrong silently duplicates data.
 *
 * Only the commands that are meaningful on a record that has just
 * been created exist here (`create`, `link`, `set`). Odoo's
 * update/delete/unlink/clear operate on records that already have
 * relations, so they belong with a future write()-with-commands
 * feature rather than create.
 */
export declare const Command: Readonly<{
    /**
     * Create a new related record and associate it with the parent.
     * For `hasMany` the parent's key is written into the child's
     * foreign key for you; for `belongsToMany` a pivot row is added.
     *
     * @param {Record<string, unknown>} values
     */
    create(values: Record<string, unknown>): any;
    /**
     * Associate an already-existing related record, by id.
     * For `hasMany` this points the child's foreign key at the parent
     * (moving it if it belonged to another parent); for `belongsToMany`
     * it adds a pivot row.
     *
     * @param {number|string} id
     */
    link(id: number | string): any;
    /**
     * Shorthand for linking several existing records. On a freshly
     * created parent this is identical to one `link` per id.
     *
     * @param {Array<number|string>} ids
     */
    set(ids: Array<number | string>): any;
}>;
/**
 * @param {unknown} value
 * @returns {boolean}
 */
export declare function isCommand(value: unknown): boolean;
/** Relation types that can be written through a create payload. */
export declare const WRITABLE_RELATION_TYPES: Set<string>;
/**
 * Validates one relation's value from a create payload and flattens
 * it into a list of primitive operations - `{ type: "create", values }`
 * or `{ type: "link", id }` - each tagged with `index`, its position
 * in the caller's array, so later errors can point at the exact entry
 * (`items[2].quantity`) even after `set([...])` expands to many links.
 *
 * Accepts `Command.*()` results and bare ids (shorthand for link).
 * Anything else - notably a plain object - is rejected with a message
 * that says how to fix it, for the reason given on `Command`.
 *
 * Structural problems throw `RelationError` here, before any SQL runs.
 *
 * @param {string} modelName
 * @param {string} relationName
 * @param {import('./define-relation.js').RelationDescriptor} relation
 * @param {unknown} value
 * @returns {Array<{ type: "create", values: Record<string, unknown>, index: number } | { type: "link", id: number|string, index: number }>}
 */
export declare function normalizeRelationValue(modelName: string, relationName: string, relation: import('./define-relation.js').RelationDescriptor, value: unknown): Array<{
    type: "create";
    values: Record<string, unknown>;
    index: number;
} | {
    type: "link";
    id: number | string;
    index: number;
}>;
