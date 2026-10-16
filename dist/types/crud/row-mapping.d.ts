/**
 * Marks a record that was read with a field selection. Non-enumerable and symbol-keyed, so it
 * never shows up in `Object.keys()`, spread or JSON. Carries `{ computed }`, the computed fields
 * that were safe to define on it.
 */
export declare const PARTIAL: unique symbol;
/**
 * Converts a raw DB row (keyed by column name, with driver-native
 * value shapes) into a record keyed by field name, with values run
 * through castValue() so callers always get back the same shapes they
 * put in (Date objects for date/datetime, real objects for json,
 * booleans for boolean) regardless of how a given dialect's driver
 * represents them on the wire.
 *
 * `json` columns need one extra step before casting: SQLite has no
 * native JSON type, so Knex stores it as a text column and the driver
 * hands back a JSON *string*, not the parsed value. Postgres, in
 * contrast, generally hands back an already-parsed object for
 * json/jsonb columns. castValue() alone can't tell these apart
 * (a string is technically valid JSON too), so the string case is
 * parsed here first, before the value ever reaches castValue().
 *
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {Record<string, unknown>} row
 * @param {import('../fields/registry.js').FieldTypeRegistry} [fieldTypeRegistry]
 * @param {{ computed?: Set<string>|null }} [options] - `computed`: which computed fields to define
 *   (default: all). A row read with `select` only defines the ones whose dependencies it carries; the
 *   choice is remembered under PARTIAL so an entity built from the record can make the same one.
 * @returns {Record<string, unknown>}
 */
export declare function fromRow(model: import('../models/define-model.js').ModelDescriptor, row: Record<string, unknown>, fieldTypeRegistry?: import('../fields/registry.js').FieldTypeRegistry, options?: {
    computed?: Set<string> | null;
}): Record<string, unknown>;
/**
 * Converts a record keyed by field name into a plain object keyed by
 * column name, ready to hand to Knex's insert()/update(). Assumes
 * values have already been validated/cast by the caller (see
 * prepareWrite()) - this function only renames keys, it does not
 * validate or coerce anything itself.
 *
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {Record<string, unknown>} fieldValues
 * @returns {Record<string, unknown>}
 */
export declare function toRow(model: import('../models/define-model.js').ModelDescriptor, fieldValues: Record<string, unknown>): Record<string, unknown>;
