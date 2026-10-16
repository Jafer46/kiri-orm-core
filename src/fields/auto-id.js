import { randomUUID } from "node:crypto";

/**
 * Sentinel default for an auto-increment integer `id`: "leave this
 * column out of the INSERT and let the database assign it". Never a
 * real value - prepareWrite() recognizes it and skips the field.
 */
export const AUTO_INCREMENT = Symbol.for("@kiri-orm/core.autoIncrement");

/**
 * Whether a field gets automatic primary-key assignment: it must be
 * the model's primary key, typed `integer` or `uuid`, must not set its
 * own `default` (yours wins), and must not opt out with `auto: false`.
 *
 * "The primary key" is a field flagged `primary: true` (defineModel()
 * flags it), or - for a bare descriptor that carries no flag at all - one
 * named `id`. A field explicitly flagged `primary: false` never qualifies.
 */
export function isAutoId(fieldName, field) {
  return (
    (field.primary === true ||
      (field.primary === undefined && fieldName === "id")) &&
    (field.type === "integer" || field.type === "uuid") &&
    field.auto !== false &&
    field.default === undefined
  );
}

/**
 * Returns `field` with its automatic-id default baked in (or `field`
 * unchanged if it doesn't qualify). Baking it into the descriptor once,
 * at definition time, means every existing consumer of `field.default`
 * (defaultFor(), the DTO generator's "required unless it has a
 * default" rule, schema building) handles it with no special cases.
 *
 *   - integer: AUTO_INCREMENT sentinel; the DB assigns it.
 *   - uuid: a factory calling crypto.randomUUID() per record.
 */
export function applyAutoIdDefault(fieldName, field) {
  if (!isAutoId(fieldName, field)) return field;
  const isInteger = field.type === "integer";
  const generated = isInteger ? AUTO_INCREMENT : () => randomUUID();
  // `autoId` is the JSON-serializable record of what `default` stands for. The default
  // itself (a Symbol / a function) can't survive JSON.stringify, which is how migration
  // files and the recorded metadata carry field descriptors - so anything rebuilding a
  // column from a serialized descriptor (buildColumn) reads this flag instead.
  return Object.freeze({
    ...field,
    default: generated,
    autoId: isInteger ? "increment" : "uuid",
  });
}
