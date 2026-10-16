import { validateValue } from "../fields/validate-value.js";
import { castValue } from "../fields/cast-value.js";
import { defaultFor } from "../fields/default-for.js";
import { AUTO_INCREMENT } from "../fields/auto-id.js";
import { defaultFieldTypeRegistry } from "../fields/default-registry.js";
import { primaryKeyOf } from "../models/primary-key.js";
import { ValidationError } from "./errors.js";

/**
 * Validates and casts a plain `{ fieldName: value }` object against a
 * model's fields, ready to be handed to toRow() for the actual write.
 *
 * Order matters here: each present value is **cast first, then
 * validated** - not the other way around. castValue() coerces loose
 * input (a numeric string for an integer field, "true" for a boolean)
 * into the field's canonical representation; validateValue() then
 * checks constraints (min/max, maxLength, enum membership) against
 * that canonical value. Validating before casting would reject
 * perfectly reasonable input like `{ id: "1" }` for an integer field,
 * since validateValue()'s type check is intentionally strict and
 * doesn't coerce - only castValue() does.
 *
 * Collects every problem across every field into one `errors` map
 * rather than throwing on the first bad field, so a caller (or a
 * future DTO/form layer) can report everything wrong with a record at
 * once instead of a frustrating one-error-at-a-time loop.
 *
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {Record<string, unknown>} data
 * @param {Object} [options]
 * @param {boolean} [options.partial] - if true (update semantics),
 *   fields absent from `data` are left untouched: no default is
 *   applied and they don't appear in the returned `values`. If false
 *   (create semantics, the default), an absent field's default is
 *   applied via defaultFor() before casting/validation.
 * @param {import('../fields/registry.js').FieldTypeRegistry} [fieldTypeRegistry]
 * @returns {{ errors: Record<string, string[]>, values: Record<string, unknown> }}
 */
export function prepareWrite(model, data, options = {}, fieldTypeRegistry = defaultFieldTypeRegistry) {
  const partial = Boolean(options.partial);
  const errors = {};
  const values = {};

  for (const [fieldName, field] of Object.entries(model.fields)) {
    const provided = Object.prototype.hasOwnProperty.call(data, fieldName);

    let value;
    if (provided) {
      value = data[fieldName];
    } else if (partial) {
      continue; // update: untouched fields are left alone entirely
    } else {
      value = defaultFor(field); // create: fall back to the field's default
      // Auto-increment id: leave it out entirely so the INSERT omits the column
      // and the database assigns it. (Not a real value - never cast or validated.)
      if (value === AUTO_INCREMENT) continue;
    }

    if (value !== null && value !== undefined) {
      try {
        value = castValue(field, value, fieldTypeRegistry);
      } catch (err) {
        errors[fieldName] = [err.message];
        continue;
      }
    }

    const fieldErrors = validateValue(field, value, fieldTypeRegistry);
    if (fieldErrors.length > 0) {
      errors[fieldName] = fieldErrors;
      continue;
    }

    values[fieldName] = value;
  }

  for (const key of Object.keys(data)) {
    if (!(key in model.fields)) {
      errors[key] = [
        model.computed && Object.prototype.hasOwnProperty.call(model.computed, key)
          ? `"${key}" is a computed field on model "${model.name}" and can't be written`
          : `unknown field "${key}" on model "${model.name}"`,
      ];
    }
  }

  return { errors, values };
}

/**
 * Refuses an update that names the model's primary key.
 *
 * A primary key is fixed once the row exists. Letting it change would (a) orphan
 * every foreign key and pivot row that points at the old value, since nothing here
 * rewrites them, and (b) on Postgres let an auto-increment key jump to a value the
 * sequence hasn't reached yet, so a later auto-assigned id collides with it. Both are
 * silent until something else breaks, so the write is rejected up front - before any
 * hook runs or any SQL is sent.
 *
 * Applies to every primary key, auto-assigned or not. A model with no primary key
 * has nothing to protect. Renumbering a row deliberately is still possible through
 * raw SQL (`client.db` / `getConnection()`); follow it with `syncSequences()`.
 *
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {Record<string, unknown>} data - the fields about to be written
 * @throws {ValidationError}
 */
export function assertPrimaryKeyUntouched(model, data) {
  const key = primaryKeyOf(model);
  if (key === null || !Object.prototype.hasOwnProperty.call(data, key)) return;
  throw new ValidationError(model.name, {
    [key]: [
      `"${key}" is the primary key of model "${model.name}" and can't be changed once the record exists. ` +
        `Create a new record and delete the old one, or renumber with raw SQL and then call syncSequences().`,
    ],
  });
}
