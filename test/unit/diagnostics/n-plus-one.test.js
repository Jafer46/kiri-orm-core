import { EventEmitter } from "node:events";
import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_THRESHOLD, NPlusOneError, QueryMonitor, describeFindings, normalizeSql, scanForNPlusOne, statementOf, watchForNPlusOne,
} from "../../../src/diagnostics/n-plus-one.js";

/** All a monitor needs of a connection: `on` and `removeListener` for "query". */
const fakeDb = () => {
  const db = new EventEmitter();
  db.run = (sql) => db.emit("query", { sql });
  return db;
};

describe("normalizeSql", () => {
  it("makes SQLite and Postgres placeholders the same", () => {
    expect(normalizeSql("select * from `post` where `id` = ?")).toBe(normalizeSql('select * from `post` where `id` = $1'));
    expect(normalizeSql('select * from "post" where "id" = $1 and "x" = $2')).toBe('select * from "post" where "id" = ? and "x" = ?');
  });

  it("ignores the length of an IN list", () => {
    const a = normalizeSql("select * from comment where post_id in (?, ?, ?)");
    expect(a).toBe("select * from comment where post_id in (?)");
    expect(normalizeSql("select * from comment where post_id in ($1)")).toBe(a);
    expect(normalizeSql("select * from comment where post_id in ($1,$2,$3,$4,$5,$6)")).toBe(a);
  });

  it("collapses multi-row inserts to one row, in both dialects' spellings", () => {
    expect(normalizeSql("insert into t (a, b) values ($1, $2), ($3, $4), ($5, $6)")).toBe("insert into t (a, b) values (?, ?)");
    expect(normalizeSql("insert into `t` (`a`) select ? as `a` union all select ? as `a` union all select ? as `a`")).toBe(
      "insert into `t` (`a`) select ? as `a` union all select ..."
    );
  });

  it("ignores case and whitespace, and keeps what makes statements different", () => {
    expect(normalizeSql("SELECT  *\n FROM   post")).toBe("select * from post");
    expect(normalizeSql("select * from post where id = ?")).not.toBe(normalizeSql("select * from post where author_id = ?"));
    expect(normalizeSql("select * from post where id = ? limit 1")).not.toBe(normalizeSql("select * from post where id = ?"));
  });
});

describe("statementOf", () => {
  it.each([
    ["select 1", "select"], ["  SELECT 1", "select"], ["(select 1) union (select 2)", "select"], ["with x as (select 1) select * from x", "select"],
    ["insert into t values (1)", "insert"], ["update t set a = 1", "update"], ["delete from t", "delete"], ["BEGIN;", "begin"], ["COMMIT;", "commit"], ["", ""],
  ])("%j -> %j", (sql, expected) => expect(statementOf(sql)).toBe(expected));
});

describe("QueryMonitor", () => {
  const select = (n) => `select * from post where id = $${n}`;

  it("flags a shape once it reaches the threshold (default 5), counting every repeat in scope", () => {
    const db = fakeDb();
    const monitor = new QueryMonitor().attach(db);
    for (let i = 0; i < 4; i++) db.run(select(1));
    expect(monitor.findings).toEqual([]); // 4 is under the default of 5
    db.run(select(1));
    db.run(select(1));
    expect(monitor.findings).toMatchObject([{ statement: "select", count: 6, shape: "select * from post where id = ?" }]);
    expect(DEFAULT_THRESHOLD).toBe(5);
  });

  it("repeats with different values or IN lists are the same shape; different statements are not", () => {
    const db = fakeDb();
    const monitor = new QueryMonitor({ threshold: 3 }).attach(db);
    db.run("select * from c where post_id in (?)");
    db.run("select * from c where post_id in (?, ?)");
    db.run("select * from c where post_id in ($1, $2, $3)");
    db.run("select * from c where user_id in (?)");
    db.run("select * from c where user_id in (?)");
    expect(monitor.findings.map((f) => [f.shape, f.count])).toEqual([["select * from c where post_id in (?)", 3]]);
  });

  it("calls onDetect once per shape, at the moment it reaches the threshold", () => {
    const db = fakeDb();
    const onDetect = vi.fn();
    new QueryMonitor({ threshold: 3, onDetect }).attach(db);
    for (let i = 0; i < 10; i++) db.run(select(1));
    expect(onDetect).toHaveBeenCalledTimes(1);
    expect(onDetect.mock.calls[0][0]).toMatchObject({ count: 3, statement: "select" });
  });

  it("counts only selects by default, ignores bookkeeping, and can be told to count others", () => {
    const db = fakeDb();
    const monitor = new QueryMonitor({ threshold: 2 }).attach(db);
    for (const sql of ["insert into t (a) values (?)", "insert into t (a) values (?)", "BEGIN;", "BEGIN;", "COMMIT;", "COMMIT;", "update t set a = ?", "update t set a = ?"]) db.run(sql);
    expect(monitor.findings).toEqual([]);

    const inserts = new QueryMonitor({ threshold: 2, statements: ["insert", "update"] }).attach(db);
    for (const sql of ["insert into t (a) values (?)", "insert into t (a) values (?)", "BEGIN;", "BEGIN;"]) db.run(sql);
    expect(inserts.findings.map((f) => f.statement)).toEqual(["insert"]); // BEGIN still ignored
  });

  it("ignores the ORM's own sequence maintenance, and anything you tell it to", () => {
    const db = fakeDb();
    const monitor = new QueryMonitor({ threshold: 2, statements: ["select", "insert"], ignore: [/from `audit`/] }).attach(db);
    for (let i = 0; i < 4; i++) db.run("select setval(pg_get_serial_sequence($1, $2), 1)"); // advanceSequence(), once per insert
    for (let i = 0; i < 4; i++) db.run("select * from `audit` where id = ?");
    expect(monitor.findings).toEqual([]);
    db.run("select * from other"); db.run("select * from other");
    expect(monitor.findings.map((f) => f.shape)).toEqual(["select * from other"]); // everything else still counted
  });

  it("windowMs: a shape's count starts over after a quiet spell, but the peak is kept", () => {
    const db = fakeDb();
    let now = 0;
    const monitor = new QueryMonitor({ threshold: 3, windowMs: 100, now: () => now }).attach(db);
    for (const t of [0, 10, 20]) { now = t; db.run(select(1)); } // a burst of 3: flagged
    expect(monitor.findings).toHaveLength(1);

    monitor.reset();
    for (const t of [0, 10]) { now = t; db.run(select(1)); }
    now = 500; db.run(select(1)); // 2 + a straggler a long time later: not a burst of 3
    expect(monitor.findings).toEqual([]);
    now = 510; db.run(select(1));
    now = 520; db.run(select(1)); // the straggler started a new burst: 500, 510, 520
    expect(monitor.findings).toMatchObject([{ count: 3 }]);
  });

  it("with the default infinite window, spacing doesn't matter", () => {
    const db = fakeDb();
    let now = 0;
    const monitor = new QueryMonitor({ threshold: 3, now: () => now }).attach(db);
    for (const t of [0, 10_000, 99_999_999]) { now = t; db.run(select(1)); }
    expect(monitor.findings).toHaveLength(1);
  });

  it("orders findings by how often they repeated", () => {
    const db = fakeDb();
    const monitor = new QueryMonitor({ threshold: 2 }).attach(db);
    for (let i = 0; i < 2; i++) db.run("select 1 from a");
    for (let i = 0; i < 7; i++) db.run("select 1 from b");
    for (let i = 0; i < 4; i++) db.run("select 1 from c");
    expect(monitor.findings.map((f) => f.count)).toEqual([7, 4, 2]);
  });

  it("attach / detach / reset", () => {
    const db = fakeDb();
    const monitor = new QueryMonitor({ threshold: 2 });
    expect(db.listenerCount("query")).toBe(0);
    monitor.attach(db);
    expect(db.listenerCount("query")).toBe(1);
    expect(() => monitor.attach(db)).toThrow(/already attached/);
    db.run(select(1)); db.run(select(1));
    monitor.detach();
    monitor.detach(); // twice is fine
    expect(db.listenerCount("query")).toBe(0);
    db.run(select(1)); // no longer counted
    expect(monitor.findings[0].count).toBe(2); // findings survive detach
    monitor.reset();
    expect(monitor.findings).toEqual([]);
  });

  it("assertClean throws an NPlusOneError carrying the findings, with advice", () => {
    const db = fakeDb();
    const monitor = new QueryMonitor({ threshold: 2 }).attach(db);
    monitor.assertClean(); // nothing yet: fine
    db.run(select(1)); db.run(select(2));
    let error;
    try { monitor.assertClean(); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(NPlusOneError);
    expect(error.findings).toHaveLength(1);
    expect(error.message).toMatch(/Possible N\+1.*2 x select: select \* from post where id = \$1/s);
    expect(error.message).toMatch(/find\(\{ with: \[\.\.\.\] \}\), loadMany\(rows, "relation"\), or an aggregate\(\)/);
  });

  it("ignores events without SQL", () => {
    const db = fakeDb();
    const monitor = new QueryMonitor({ threshold: 2 }).attach(db);
    db.emit("query", {}); db.emit("query", undefined); db.emit("query", { sql: 42 });
    expect(monitor.findings).toEqual([]);
  });

  it.each([1, 0, 2.5, "5", false])("rejects a threshold of %j", (threshold) => {
    expect(() => new QueryMonitor({ threshold })).toThrow(RangeError);
  });
});

describe("scanForNPlusOne / watchForNPlusOne", () => {
  it("scan returns the result and findings, and always detaches - even when fn throws", async () => {
    const db = fakeDb();
    const { result, findings } = await scanForNPlusOne(db, async () => { for (let i = 0; i < 6; i++) db.run("select 1 from t"); return "done"; });
    expect(result).toBe("done");
    expect(findings).toMatchObject([{ count: 6 }]);
    expect(db.listenerCount("query")).toBe(0);

    await expect(scanForNPlusOne(db, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(db.listenerCount("query")).toBe(0);
  });

  it("watch warns once per statement on the console by default, with a 250ms window", () => {
    const db = fakeDb();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const monitor = watchForNPlusOne(db);
    for (let i = 0; i < 12; i++) db.run("select * from post where id = ?");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/Possible N\+1/);
    monitor.detach();
    warn.mockRestore();
  });

  it("watch takes its own onDetect and options", () => {
    const db = fakeDb();
    const onDetect = vi.fn();
    const monitor = watchForNPlusOne(db, { threshold: 2, onDetect });
    db.run("select 1 from t"); db.run("select 1 from t");
    expect(onDetect).toHaveBeenCalledTimes(1);
    monitor.detach();
  });
});

describe("describeFindings", () => {
  it("shortens long SQL and lists every finding", () => {
    const long = `select ${"a, ".repeat(100)} from t`;
    const text = describeFindings([
      { shape: "s", sql: long, statement: "select", count: 9 },
      { shape: "t", sql: "select 1", statement: "select", count: 2 },
    ]);
    expect(text).toContain("9 x select:");
    expect(text).toContain("2 x select: select 1");
    expect(text).toContain("...");
    expect(text).not.toMatch(/first seen|callSite/);
  });
});
