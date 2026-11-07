import { CastError } from "../errors.js";

// year first; separators must match; optional time part with optional zone
const DATE_RE =
  /^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?)?$/i;

function isLeap(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y, m) {
  if (m === 2) return isLeap(y) ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

function isRealCalendarDate(y, m, d) {
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

function format(y, m, d) {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function normalizeOffset(z) {
  if (z.toUpperCase() === "Z") return "Z";
  const sign = z[0];
  const digits = z.slice(1).replace(":", "");
  const hh = digits.slice(0, 2);
  const mm = digits.slice(2) || "00";
  return `${sign}${hh}:${mm}`;
}

// Calendar day of an instant in a given IANA timezone.
function dayInZone(instant, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(instant);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return format(get("year"), get("month"), get("day"));
}

function parseString(field, raw) {
  const match = DATE_RE.exec(raw.trim());
  if (!match) return null;

  const y = Number(match[1]);
  const m = Number(match[3]);
  const d = Number(match[4]);
  if (!isRealCalendarDate(y, m, d)) return null;

  const hasTime = match[5] !== undefined;
  if (hasTime) {
    const [hh, mi, ss] = [match[5], match[6], match[7] ?? "0"].map(Number);
    if (hh > 23 || mi > 59 || ss > 59) return null;
  }

  const offset = match[8];
  if (hasTime && offset && field?.timeZone) {
    // The string is an instant: convert it to a day in the field's zone.
    const iso =
      `${format(y, m, d)}T${match[5]}:${match[6]}:${String(match[7] ?? "0").padStart(2, "0")}` +
      normalizeOffset(offset);
    const instant = new Date(iso);
    return Number.isNaN(instant.getTime())
      ? null
      : dayInZone(instant, field.timeZone);
  }

  // Default: the date exactly as written; time and offset are ignored.
  return format(y, m, d);
}

function fromDateObject(dt) {
  if (Number.isNaN(dt.getTime())) return null;
  return format(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

const DAY_MS = 86_400_000;

/**
 * Epoch milliseconds -> "YYYY-MM-DD". This is how 0.1.0-0.1.2 stored `date` fields on SQLite
 * (they were Date objects then, and Knex's SQLite client binds a Date as its valueOf()), so
 * these rows must keep reading after an upgrade - from 0.1.3 to 0.1.5 they threw
 * "cannot cast 1706832000000 to date" instead.
 *
 * Which calendar day a stored instant meant depends on how the old Date was built:
 *   - from a date string (`new Date("2024-03-01")`, the common case - JSON input) it is UTC
 *     midnight, so the UTC day is the right one;
 *   - from local components (`new Date(2024, 2, 1)`) it is local midnight on the server that
 *     wrote it, so the local day is the right one.
 * An instant at exactly UTC midnight is read as that UTC day, one at exactly local midnight as
 * that local day; anything else (a date carrying a time) falls back to the UTC day.
 */
function fromEpochMs(ms) {
  if (!Number.isFinite(ms)) return null;
  const dt = new Date(ms);
  if (Number.isNaN(dt.getTime())) return null;
  const utcDay = format(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  if (((ms % DAY_MS) + DAY_MS) % DAY_MS === 0) return utcDay;
  const isLocalMidnight = dt.getHours() === 0 && dt.getMinutes() === 0 && dt.getSeconds() === 0 && dt.getMilliseconds() === 0;
  return isLocalMidnight ? fromDateObject(dt) : utcDay;
}

export const dateType = {
  name: "date",

  // validate stays strict: it only accepts the canonical stored form.
  validate(field, value) {
    const ok =
      typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      isRealCalendarDate(
        +value.slice(0, 4),
        +value.slice(5, 7),
        +value.slice(8, 10),
      );
    return ok
      ? []
      : [
          `expected a real calendar date as "YYYY-MM-DD", got ${JSON.stringify(value)}`,
        ];
  },

  cast(field, value) {
    let result = null;
    if (typeof value === "string") result = parseString(field, value);
    else if (value instanceof Date) result = fromDateObject(value);
    else if (typeof value === "number") result = fromEpochMs(value);

    if (result === null) {
      throw new CastError(`cannot cast ${JSON.stringify(value)} to date`, {
        fieldType: "date",
        value,
      });
    }
    return result;
  },
};
