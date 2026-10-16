import { CastError } from "../errors.js";

// Deliberately permissive about the version/variant nibbles: this accepts
// any RFC 4122-shaped value (v1, v4, v7, ...), including ids imported from
// elsewhere, not only ones this ORM generated itself.
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A UUID, stored as a native `uuid` column on Postgres and as
 * `char(36)` on SQLite (Knex's `table.uuid()` already handles that
 * per-dialect difference - see schema/default-column-builders.js).
 *
 * A field named "id" with this type is auto-generated on create() via
 * `crypto.randomUUID()` unless you supply your own value or your own
 * `default` - see fields/auto-id.js.
 */
export const uuidType = {
  name: "uuid",

  validate(field, value) {
    if (typeof value !== "string" || !UUID_SHAPE.test(value)) {
      return [`expected a UUID string (8-4-4-4-12 hex), got ${JSON.stringify(value)}`];
    }
    return [];
  },

  cast(field, value) {
    if (typeof value === "string" && UUID_SHAPE.test(value)) return value.toLowerCase();
    throw new CastError(`cannot cast ${JSON.stringify(value)} to uuid`, { fieldType: "uuid", value });
  },
};
