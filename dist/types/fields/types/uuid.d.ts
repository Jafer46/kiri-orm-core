/**
 * A UUID, stored as a native `uuid` column on Postgres and as
 * `char(36)` on SQLite (Knex's `table.uuid()` already handles that
 * per-dialect difference - see schema/default-column-builders.js).
 *
 * A field named "id" with this type is auto-generated on create() via
 * `crypto.randomUUID()` unless you supply your own value or your own
 * `default` - see fields/auto-id.js.
 */
export declare const uuidType: {
    name: string;
    validate(field: any, value: any): string[];
    cast(field: any, value: any): string;
};
