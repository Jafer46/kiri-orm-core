/**
 * An N+1 detector: notices when the same SQL statement is sent over and over, which is what
 * "load the parent, then query for each child" looks like from the database's side - one query
 * for the list, then one more per row.
 *
 * It watches the connection's `query` events (which also carry the queries of any transaction on
 * it), reduces every statement to its SHAPE, and counts repeats of a shape. Two statements have the
 * same shape when only their values differ:
 *
 *   select * from post where id = $1                  -- and the same with = ?, or any id
 *   select * from comment where post_id in (?, ?, ?)  -- and the same with a list of any length
 *
 * So looping `findOne({ id })` over a hundred ids is one shape seen 100 times, while one batched
 * `find({ with })` is a few different shapes seen once each.
 *
 * It is a heuristic and says so: a legitimate loop (a batch job paging through rows) repeats a
 * statement too. That is why it reports and, unless you ask it to, doesn't throw - and why the
 * threshold and the time window are yours to set. Only SELECTs are counted by default: a loop of
 * inserts is a different, usually deliberate, pattern.
 *
 * Meant for development and tests, not production: it adds a cheap string pass per statement.
 *
 * It reports WHAT repeated (the statement, and how many times), not WHERE it was called from. That
 * would need the caller's stack, and by the time knex emits its query event that is gone: query builders
 * are non-native thenables, and V8's async stack traces don't continue through them. The statement itself
 * - it names the table and the column - is what to search your code for.
 *
 * @typedef {{ shape: string, sql: string, statement: string, count: number }} Finding
 */

export const DEFAULT_THRESHOLD = 5;

/** Marks bookkeeping that is never a data query. */
const BOOKKEEPING = new Set(["begin", "commit", "rollback", "savepoint", "release", "pragma", "set", "show"]);

/**
 * Statements the ORM itself sends that look like reads but aren't: advanceSequence() runs
 * `select setval(...)` before every insert that carries explicit ids on Postgres, so N such inserts
 * are N identical "selects" - not an N+1 anyone should be told about.
 */
const ORM_INTERNAL = [/^\s*select setval\(/i];

/**
 * Reduces a statement to its shape: the same text with the values and the list lengths taken out.
 * Postgres `$1` and SQLite `?` placeholders both become `?`; `in (?, ?, ?)` becomes `in (?)`; a
 * multi-row `values (?, ?), (?, ?)` becomes one row.
 *
 * @param {string} sql
 * @returns {string}
 */
export function normalizeSql(sql) {
  return String(sql)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\$\d+/g, "?")
    .replace(/\bin \(\?(?:, ?\?)*\)/g, "in (?)")
    .replace(/\bvalues (\(\?(?:, ?\?)*\))(?:, ?\(\?(?:, ?\?)*\))+/g, "values $1")
    .replace(/( union all select (?:\? as [`"\w]+(?:, )?)+)+/g, " union all select ...") // SQLite's multi-row insert
    .trim();
}

/** The kind of statement: `select`, `insert`, `update`, `delete`, or a bookkeeping word. A CTE counts as a select. */
export function statementOf(sql) {
  const word = /^\s*\(?\s*(\w+)/.exec(String(sql))?.[1]?.toLowerCase() ?? "";
  return word === "with" ? "select" : word === "del" ? "delete" : word;
}

export class NPlusOneError extends Error {
  /** @param {Finding[]} findings */
  constructor(findings) {
    super(describeFindings(findings));
    this.name = "NPlusOneError";
    this.findings = findings;
  }
}

/** A readable report: each repeated statement, how often, and what to do about it. */
export function describeFindings(findings) {
  const lines = findings.map(
    (f) => `  ${f.count} x ${f.statement}: ${f.sql.length > 140 ? `${f.sql.slice(0, 140)}...` : f.sql}`
  );
  return (
    `Possible N+1: the same statement ran repeatedly.\n${lines.join("\n")}\n` +
    `Load the related rows in one go instead: find({ with: [...] }), loadMany(rows, "relation"), or an aggregate().`
  );
}

export class QueryMonitor {
  #threshold;
  #windowMs;
  #statements;
  #ignore;
  #onDetect;
  #now;
  #shapes = new Map();
  #db = null;
  #listener = (query) => this.#observe(query);

  /**
   * @param {object} [options]
   * @param {number} [options.threshold] - repeats of one shape that count as N+1 (default 5)
   * @param {number} [options.windowMs] - a shape's count starts over after this long without it; `Infinity`
   *   (the default) counts everything seen. A live watcher usually wants a few hundred ms.
   * @param {string[]} [options.statements] - which statements to count (default `["select"]`)
   * @param {RegExp[]} [options.ignore] - statements to skip, matched against the SQL; added to the ORM's own
   *   (sequence maintenance), not replacing them
   * @param {(finding: Finding) => void} [options.onDetect] - called once when a shape first reaches the threshold
   * @param {() => number} [options.now] - clock, for tests
   */
  constructor({ threshold = DEFAULT_THRESHOLD, windowMs = Infinity, statements = ["select"], ignore = [], onDetect = () => {}, now = Date.now } = {}) {
    if (!Number.isInteger(threshold) || threshold < 2) throw new RangeError(`\`threshold\` must be a whole number of at least 2 (got ${threshold})`);
    this.#threshold = threshold;
    this.#windowMs = windowMs;
    this.#statements = new Set(statements);
    this.#ignore = [...ORM_INTERNAL, ...ignore];
    this.#onDetect = onDetect;
    this.#now = now;
  }

  /** Starts listening on a connection (or transaction). One monitor watches one connection at a time. */
  attach(db) {
    if (this.#db) throw new Error("This monitor is already attached; detach() it first");
    this.#db = db;
    db.on("query", this.#listener);
    return this;
  }

  /** Stops listening. Safe to call twice. The findings so far are kept. */
  detach() {
    if (this.#db) this.#db.removeListener("query", this.#listener);
    this.#db = null;
    return this;
  }

  /** Forgets everything counted so far. */
  reset() {
    this.#shapes.clear();
    return this;
  }

  /** The shapes that reached the threshold, most repeated first. @returns {Finding[]} */
  get findings() {
    return [...this.#shapes.values()]
      .filter((entry) => entry.flagged)
      .map(({ shape, sql, statement, peak }) => ({ shape, sql, statement, count: peak }))
      .sort((a, b) => b.count - a.count);
  }

  /** Throws NPlusOneError if anything was found. */
  assertClean() {
    const findings = this.findings;
    if (findings.length > 0) throw new NPlusOneError(findings);
  }

  #observe(query) {
    const sql = query?.sql;
    if (typeof sql !== "string") return;
    const statement = statementOf(sql);
    if (BOOKKEEPING.has(statement) || !this.#statements.has(statement)) return;
    if (this.#ignore.some((pattern) => pattern.test(sql))) return;

    const shape = normalizeSql(sql);
    const now = this.#now();
    let entry = this.#shapes.get(shape);
    if (!entry) {
      entry = { shape, sql, statement, count: 0, peak: 0, lastAt: now, flagged: false };
      this.#shapes.set(shape, entry);
    }
    if (now - entry.lastAt > this.#windowMs) entry.count = 0; // quiet for a while: a new burst
    entry.count += 1;
    entry.lastAt = now;
    entry.peak = Math.max(entry.peak, entry.count);

    if (entry.count >= this.#threshold && !entry.flagged) {
      entry.flagged = true;
      this.#onDetect({ shape, sql, statement, count: entry.count });
    }
  }
}

/**
 * Runs `fn` while watching `db`, then reports what repeated. Never throws for findings.
 *
 * @template T
 * @param {import('knex').Knex} db
 * @param {() => Promise<T>} fn
 * @param {ConstructorParameters<typeof QueryMonitor>[0]} [options]
 * @returns {Promise<{ result: T, findings: Finding[] }>}
 */
export async function scanForNPlusOne(db, fn, options = {}) {
  const monitor = new QueryMonitor(options).attach(db);
  try {
    const result = await fn();
    return { result, findings: monitor.findings };
  } finally {
    monitor.detach();
  }
}

/**
 * A live watcher for development: warns (once per statement) on the console the moment one shape
 * repeats `threshold` times within `windowMs`. Call `.detach()` to stop.
 *
 * @param {import('knex').Knex} db
 * @param {ConstructorParameters<typeof QueryMonitor>[0]} [options] - `windowMs` defaults to 250, `onDetect` to console.warn
 * @returns {QueryMonitor}
 */
export function watchForNPlusOne(db, options = {}) {
  const { onDetect = (finding) => console.warn(describeFindings([finding])), windowMs = 250, ...rest } = options;
  return new QueryMonitor({ ...rest, windowMs, onDetect }).attach(db);
}
