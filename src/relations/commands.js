import { RelationError } from "./errors.js";

/**
 * Brand used to tell a real `Command.*()` result apart from an
 * arbitrary object a caller happened to pass. `Symbol.for` (rather
 * than a plain `Symbol()`) so the brand is still recognized if two
 * copies of this package end up in one process.
 */
const COMMAND_BRAND = Symbol.for("@kiri-orm/core.relationCommand");

function makeCommand(type, payload) {
  return Object.freeze({ ...payload, type, [COMMAND_BRAND]: true });
}

function isId(value) {
  return (
    (typeof value === "number" && Number.isFinite(value)) ||
    (typeof value === "string" && value !== "")
  );
}

function describe(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "object") return "an object";
  return `${typeof value} ${JSON.stringify(value)}`;
}

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
export const Command = Object.freeze({
  /**
   * Create a new related record and associate it with the parent.
   * For `hasMany` the parent's key is written into the child's
   * foreign key for you; for `belongsToMany` a pivot row is added.
   *
   * @param {Record<string, unknown>} values
   */
  create(values) {
    if (
      values === null ||
      typeof values !== "object" ||
      Array.isArray(values)
    ) {
      throw new TypeError(
        `Command.create() expects an object of field values, got ${describe(values)}`,
      );
    }
    return makeCommand("create", { values });
  },

  /**
   * Associate an already-existing related record, by id.
   * For `hasMany` this points the child's foreign key at the parent
   * (moving it if it belonged to another parent); for `belongsToMany`
   * it adds a pivot row.
   *
   * @param {number|string} id
   */
  link(id) {
    if (!isId(id)) {
      throw new TypeError(
        `Command.link() expects an id (number or non-empty string), got ${describe(id)}`,
      );
    }
    return makeCommand("link", { id });
  },

  /**
   * Shorthand for linking several existing records. On a freshly
   * created parent this is identical to one `link` per id.
   *
   * @param {Array<number|string>} ids
   */
  set(ids) {
    if (!Array.isArray(ids) || !ids.every(isId)) {
      throw new TypeError(
        "Command.set() expects an array of ids (numbers or non-empty strings)",
      );
    }
    return makeCommand("set", { ids: [...ids] });
  },
});

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isCommand(value) {
  return (
    value !== null && typeof value === "object" && value[COMMAND_BRAND] === true
  );
}

/** Relation types that can be written through a create payload. */
export const WRITABLE_RELATION_TYPES = new Set(["hasMany", "belongsToMany"]);

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
export function normalizeRelationValue(
  modelName,
  relationName,
  relation,
  value,
) {
  const where = `relation "${relationName}" on model "${modelName}"`;

  if (relation.type === "belongsTo") {
    throw new RelationError(
      `Cannot write ${where} through create(): it is a belongsTo, so its value lives in this model's ` +
        `foreign key field "${relation.foreignKey}" - set that field instead.`,
    );
  }
  if (!WRITABLE_RELATION_TYPES.has(relation.type)) {
    throw new RelationError(
      `Cannot write ${where} through create(): "${relation.type}" relations are not supported here yet. ` +
        `Create the related record separately and set its "${relation.foreignKey}" field.`,
    );
  }
  if (!Array.isArray(value)) {
    throw new RelationError(
      `${where} expects an array of Command.create()/Command.link()/Command.set() entries or ids, got ${describe(value)}`,
    );
  }

  const ops = [];
  value.forEach((entry, index) => {
    if (isCommand(entry)) {
      if (entry.type === "create") {
        ops.push({ type: "create", values: entry.values, index });
      } else if (entry.type === "link") {
        ops.push({ type: "link", id: entry.id, index });
      } else if (entry.type === "set") {
        for (const id of entry.ids) ops.push({ type: "link", id, index });
      } else {
        throw new RelationError(
          `${where}, entry [${index}]: unsupported command "${entry.type}"`,
        );
      }
    } else if (isId(entry)) {
      ops.push({ type: "link", id: entry, index });
    } else {
      throw new RelationError(
        `${where}, entry [${index}]: expected a Command.*() or an id, got ${describe(entry)}. ` +
          `To create a related record, wrap its values: Command.create({ ... }).`,
      );
    }
  });
  return ops;
}
