import { castValue } from "../fields/cast-value.js";
import { defaultFieldTypeRegistry } from "../fields/default-registry.js";
import { defineComputedGetters } from "../fields/computed-access.js";

/**
 * Marks a record that was read with a field selection. Non-enumerable and symbol-keyed, so it
 * never shows up in `Object.keys()`, spread or JSON. Carries `{ computed }`, the computed fields
 * that were safe to define on it.
 */
export const PARTIAL = Symbol("partialRecord");

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
 * That extra parse must only happen where the driver hands back JSON *text*. On Postgres the
 * driver has already parsed the column, so a string there IS the stored value - a JSON string
 * scalar like `"hello"` or `"123"`. Parsing it a second time turned `"123"` into the number 123
 * and made `"hello"` throw, breaking every read of the table (fixed in 0.1.6). Callers inside the
 * ORM pass `jsonParsed: isPostgres(db)`; a caller that omits it gets the SQLite behavior.
 *
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {Record<string, unknown>} row
 * @param {import('../fields/registry.js').FieldTypeRegistry} [fieldTypeRegistry]
 * @param {{ computed?: Set<string>|null, jsonParsed?: boolean }} [options] - `jsonParsed`: the driver already
 *   parsed json columns (Postgres), so a string value is a JSON string, not JSON text. `computed`: which computed fields to define
 *   (default: all). A row read with `select` only defines the ones whose dependencies it carries; the
 *   choice is remembered under PARTIAL so an entity built from the record can make the same one.
 * @returns {Record<string, unknown>}
 */
export function fromRow(model, row, fieldTypeRegistry = defaultFieldTypeRegistry, options = {}) {
  const record = {};

  for (const [fieldName, field] of Object.entries(model.fields)) {
    const columnName = model.columns[fieldName];
    if (!(columnName in row)) continue;

    let value = row[columnName];
    if (value !== null && value !== undefined) {
      if (field.type === "json" && typeof value === "string" && !options.jsonParsed) {
        value = JSON.parse(value);
      }
      value = castValue(field, value, fieldTypeRegistry);
    }
    record[fieldName] = value;
  }

  if (options.computed) {
    Object.defineProperty(record, PARTIAL, { value: { computed: options.computed }, enumerable: false });
  }
  return defineComputedGetters(record, model, options.computed ?? undefined);
}

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
export function toRow(model, fieldValues) {
  const row = {};
  for (const [fieldName, value] of Object.entries(fieldValues)) {
    const columnName = model.columns[fieldName];
    row[columnName] = value;
  }
  return row;
}
