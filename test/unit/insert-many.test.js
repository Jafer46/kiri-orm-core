import { describe, it, expect } from "vitest";
import { alignToInput, chunkArray, insertLimitsFor, rowsPerStatement } from "../../src/crud/insert-many.js";

const fakeDb = (client) => ({ client: { config: { client } } });

describe("insertLimitsFor / rowsPerStatement", () => {
  it("caps SQLite at 500 rows per statement (its compound-SELECT limit)", () => {
    expect(rowsPerStatement(fakeDb("better-sqlite3"), 2)).toBe(500);
    expect(rowsPerStatement(fakeDb("sqlite3"), 1)).toBe(500);
  });

  it("lets bind-variable limits win when rows are wide", () => {
    expect(rowsPerStatement(fakeDb("better-sqlite3"), 100)).toBe(Math.floor(32766 / 100));
    expect(rowsPerStatement(fakeDb("pg"), 100)).toBe(Math.floor(65535 / 100));
  });

  it("allows more rows per statement on Postgres", () => {
    expect(rowsPerStatement(fakeDb("pg"), 5)).toBe(1000);
  });

  it("falls back to conservative limits for an unknown dialect", () => {
    expect(insertLimitsFor(fakeDb("mysql2"))).toEqual({ maxRows: 500, maxParams: 999 });
    expect(insertLimitsFor({})).toEqual({ maxRows: 500, maxParams: 999 });
  });

  it("only lets `requested` lower the limit, never raise it, and never below 1", () => {
    const db = fakeDb("better-sqlite3");
    expect(rowsPerStatement(db, 2, 10)).toBe(10);
    expect(rowsPerStatement(db, 2, 9_999_999)).toBe(500);
    expect(rowsPerStatement(db, 2, 0)).toBe(1);
    expect(rowsPerStatement(db, 2, -4)).toBe(1);
  });

  it("copes with a zero column count", () => {
    expect(rowsPerStatement(fakeDb("pg"), 0)).toBe(1000);
  });
});

describe("chunkArray", () => {
  it("splits into consecutive chunks, keeping the remainder", () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkArray([], 3)).toEqual([]);
    expect(chunkArray([1, 2], 5)).toEqual([[1, 2]]);
  });
});

describe("alignToInput", () => {
  const model = { tableName: "post", fields: { id: {}, title: {} } };
  const values = [{ id: 3 }, { id: 1 }, { id: 2 }];

  it("returns records untouched when they already line up with the input", () => {
    const records = [{ id: 3 }, { id: 1 }, { id: 2 }];
    expect(alignToInput(model, values, records)).toBe(records);
  });

  it("re-pairs by id when the database returned rows in a different order", () => {
    const shuffled = [{ id: 1, tag: "b" }, { id: 2, tag: "c" }, { id: 3, tag: "a" }];
    expect(alignToInput(model, values, shuffled).map((r) => r.tag)).toEqual(["a", "b", "c"]);
  });

  it("pairs duplicate ids off one-to-one, in order", () => {
    const dupModel = { tableName: "t", fields: { id: {} } };
    const input = [{ id: 1 }, { id: 2 }, { id: 1 }];
    const returned = [{ id: 2, n: "x" }, { id: 1, n: "first" }, { id: 1, n: "second" }];
    expect(alignToInput(dupModel, input, returned).map((r) => r.n)).toEqual(["first", "x", "second"]);
  });

  it("throws rather than guess when the row count differs", () => {
    expect(() => alignToInput(model, values, [{ id: 3 }])).toThrow(/returned 1 rows for 3/);
  });

  it("throws when a returned row can't be matched to any input id", () => {
    expect(() => alignToInput(model, values, [{ id: 9 }, { id: 1 }, { id: 2 }])).toThrow(/no returned row matches input id 3/);
  });

  it("stays positional for a model with no id field", () => {
    const noId = { tableName: "log", fields: { message: {} } };
    const records = [{ message: "b" }, { message: "a" }];
    expect(alignToInput(noId, [{ message: "a" }, { message: "b" }], records)).toBe(records);
  });

  it("ignores inputs that had no id to compare against", () => {
    const records = [{ id: 10 }, { id: 11 }];
    expect(alignToInput(model, [{ title: "a" }, { title: "b" }], records)).toBe(records);
  });
});
