import { describe, it, expect } from "vitest";
import { defineModel } from "../../../src/models/define-model.js";
import { advanceSequence, isPostgres } from "../../../src/crud/sequence.js";

function fakeDb(client) {
  const calls = [];
  const db = Object.assign(() => {}, {
    client: { config: { client } },
    raw: async (sql, params) => {
      calls.push({ sql, params });
      return {};
    },
  });
  return { db, calls };
}

describe("isPostgres", () => {
  it("recognizes pg and postgres-family client names", () => {
    expect(isPostgres({ client: { config: { client: "pg" } } })).toBe(true);
    expect(isPostgres({ client: { config: { client: "postgresql" } } })).toBe(true);
    expect(isPostgres({ client: { config: { client: "cockroachdb" } } })).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isPostgres({ client: { config: { client: "better-sqlite3" } } })).toBe(false);
    expect(isPostgres({ client: { config: { client: "sqlite3" } } })).toBe(false);
    expect(isPostgres({})).toBe(false);
  });
});

describe("advanceSequence", () => {
  const post = defineModel({ name: "post", fields: { id: { type: "integer", required: true }, title: { type: "char" } } });
  const token = defineModel({ name: "token", fields: { id: { type: "uuid", required: true } } });
  const manual = defineModel({ name: "manual", fields: { id: { type: "integer", required: true, auto: false } } });

  it("no-op when the batch has no explicit id - the common case, no query issued", async () => {
    const { db, calls } = fakeDb("pg");
    const touched = await advanceSequence(db, post, [{ title: "a" }, { title: "b" }]);
    expect(touched).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("no-op on a non-Postgres dialect, even with explicit ids", async () => {
    const { db, calls } = fakeDb("better-sqlite3");
    const touched = await advanceSequence(db, post, [{ id: 5, title: "a" }]);
    expect(touched).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("no-op for a uuid primary key, even on Postgres", async () => {
    const { db, calls } = fakeDb("pg");
    const touched = await advanceSequence(db, token, [{ id: "6a56dc83-83ee-4109-bbc4-b4301bf55f03" }]);
    expect(touched).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("no-op when auto: false - the id isn't a serial column at all", async () => {
    const { db, calls } = fakeDb("pg");
    const touched = await advanceSequence(db, manual, [{ id: 5 }]);
    expect(touched).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("issues one setval call when an explicit integer id is present on Postgres", async () => {
    const { db, calls } = fakeDb("pg");
    const touched = await advanceSequence(db, post, [{ id: 5, title: "a" }, { title: "b" }]);
    expect(touched).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("binds the highest explicit id, the column, and the table name, in the order the placeholders appear", async () => {
    const { db, calls } = fakeDb("pg");
    await advanceSequence(db, post, [{ id: 3, title: "a" }, { id: 9, title: "b" }, { id: 5 }, {}]);
    const { sql, params } = calls[0];

    // Positional bindings must line up 1:1, in order, with the ?/?? tokens in the string.
    const tokens = sql.match(/\?\??/g);
    expect(tokens).toHaveLength(params.length);
    expect(params).toEqual([9, "id", "post", "post", "id"]); // 9 = highest explicit id in the batch
    expect(sql).toMatch(/setval/);
    expect(sql).toMatch(/pg_get_serial_sequence/);
  });

  it("floors at 1 for a zero or negative explicit id, never asking for a non-positive sequence value", async () => {
    const { db, calls } = fakeDb("pg");
    await advanceSequence(db, post, [{ id: 0 }]);
    expect(calls[0].params[0]).toBe(1);
  });

  it("coerces a numeric-string id the same as a number", async () => {
    const { db, calls } = fakeDb("pg");
    await advanceSequence(db, post, [{ id: "12" }]);
    expect(calls[0].params[0]).toBe(12);
  });
});
