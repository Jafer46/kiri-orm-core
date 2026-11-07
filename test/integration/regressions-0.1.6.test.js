import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, createModel, syncModels, transaction, migrateModels } from "../../src/global/index.js";
import { __resetGlobalStateForTests } from "../../src/global/state.js";
import { ModelRegistry } from "../../src/models/registry.js";
import { generateMigrationFile, migrateUp, MIGRATIONS_TABLE } from "../../src/migrations/runner.js";
import { MigrationStateError } from "../../src/migrations/errors.js";
import { Command } from "../../src/relations/commands.js";
import { eachIsolatedDialect } from "../helpers/isolated-dialects.js";

/**
 * Regression tests for the 0.1.6 hotfix, each one written against the bug as users hit it.
 * Run on every dialect; Postgres when TEST_PG_CONNECTION_STRING is set.
 *
 * The global API is the reference surface: `connect(db)` points it at the test's isolated
 * connection (the helper closes that connection, so these tests never call disconnect()).
 */
const useGlobal = (db) => {
  __resetGlobalStateForTests();
  connect(db);
};

const count = async (db, table) => Number((await db(table).count("* as c"))[0].c);

function tempDir() {
  return mkdtempSync(join(tmpdir(), "kiri-0.1.6-"));
}

const authorAndBooks = (authorFields) => [
  { name: "author", fields: { id: { type: "integer" }, name: { type: "char" }, ...authorFields } },
  {
    name: "book",
    fields: { id: { type: "integer" }, authorId: { type: "integer" } },
    relations: { author: { type: "belongsTo", model: "author", foreignKey: "authorId", onDelete: "cascade" } },
  },
  {
    name: "review",
    fields: { id: { type: "integer" }, authorId: { type: "integer" } },
    relations: { author: { type: "belongsTo", model: "author", foreignKey: "authorId", onDelete: "setNull" } },
  },
];

const registryOf = (models) => {
  const registry = new ModelRegistry();
  for (const model of models) registry.define(model);
  return registry;
};

describe.each(eachIsolatedDialect())("0.1.6 regressions - $name", ({ name: dialect, run }) => {
  describe("migrations never delete or null out rows of child tables", () => {
    it("dropping a column from a parent table keeps its cascade and setNull children intact", () =>
      run(async (db) => {
        const dir = tempDir();
        try {
          const before = registryOf(authorAndBooks({ legacy: { type: "char" } }));
          await generateMigrationFile(db, before, { dir });
          await migrateUp(db, { dir, modelRegistry: before });

          const [{ id }] = await db("author").insert({ name: "Ann", legacy: "x" }).returning("id");
          await db("book").insert([{ author_id: id }, { author_id: id }]);
          await db("review").insert([{ author_id: id }]);

          // Dropping a column makes Knex rebuild the table on SQLite (copy, DROP, rename).
          const after = registryOf(authorAndBooks({}));
          const { file } = await generateMigrationFile(db, after, { dir, allowDestructive: true });
          expect(file).not.toBeNull();
          await migrateUp(db, { dir, modelRegistry: after });

          expect(await count(db, "book")).toBe(2);
          expect((await db("review").select("author_id")).map((r) => r.author_id)).toEqual([id]);
          expect(await db("author").columnInfo()).not.toHaveProperty("legacy");
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }));

    it("a migration that leaves a foreign key violation is rolled back and not recorded", () =>
      run(async (db) => {
        const dir = tempDir();
        try {
          const registry = registryOf(authorAndBooks({}));
          await generateMigrationFile(db, registry, { dir });
          await migrateUp(db, { dir, modelRegistry: registry });

          writeFileSync(
            join(dir, "29990101000000_orphan.js"),
            `export async function up(db) { await db("book").insert({ author_id: 999 }); }\n` +
              `export async function down() {}\n`
          );
          await expect(migrateUp(db, { dir })).rejects.toThrow(/foreign key/i);
          expect(await count(db, "book")).toBe(0);
          expect(await db(MIGRATIONS_TABLE).where({ name: "29990101000000_orphan" }).first()).toBeUndefined();
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }));

    it.runIf(dialect === "sqlite")("refuses to run inside an outer transaction, where SQLite can't switch foreign keys off", () =>
      run(async (db) => {
        const dir = tempDir();
        try {
          const registry = registryOf(authorAndBooks({}));
          await generateMigrationFile(db, registry, { dir });
          const error = await db.transaction((trx) => migrateUp(trx, { dir })).catch((e) => e);
          expect(error).toBeInstanceOf(MigrationStateError);
          expect(error.message).toMatch(/foreign key enforcement still on/);
          expect(await db.raw("PRAGMA foreign_keys")).toEqual([{ foreign_keys: 1 }]); // left as it was
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }));

    it("migrateModels() (global API) dropping a parent column keeps child rows", () =>
      run(async (db) => {
        useGlobal(db);
        for (const model of authorAndBooks({ legacy: { type: "char" } })) createModel(model.name, model);
        await syncModels();
        const [{ id }] = await db("author").insert({ name: "Ann", legacy: "x" }).returning("id");
        await db("book").insert([{ author_id: id }, { author_id: id }]);

        useGlobal(db);
        for (const model of authorAndBooks({})) createModel(model.name, model);
        await migrateModels({ allowDestructive: true });
        expect(await count(db, "book")).toBe(2);
      }));
  });

  describe("json fields holding a string read back as that string", () => {
    const STRINGS = ["hello", "123", "true", "null", "", '{"a":1}', "[1,2]"];

    it("create(), createMany(), find() and eager loading all return the stored string", () =>
      run(async (db) => {
        useGlobal(db);
        const Doc = createModel("doc", {
          fields: { id: { type: "integer" }, data: { type: "json" } },
          relations: { notes: { type: "hasMany", model: "note", foreignKey: "docId" } },
        });
        createModel("note", {
          fields: { id: { type: "integer" }, docId: { type: "integer" }, data: { type: "json" } },
          relations: { doc: { type: "belongsTo", model: "doc", foreignKey: "docId" } },
        });
        await syncModels();

        const created = await Doc.createMany(STRINGS.map((data) => ({ data })));
        expect(created.map((d) => d.data)).toEqual(STRINGS);
        const one = await Doc.create({ data: "solo", notes: [Command.create({ data: "42" })] });
        expect(one.data).toBe("solo");

        const found = await Doc.find({}, { orderBy: "id", with: ["notes"] });
        expect(found.map((d) => d.data)).toEqual([...STRINGS, "solo"]);
        expect(found.at(-1).notes.map((n) => n.data)).toEqual(["42"]);
      }));

    it("objects, arrays, numbers and booleans are unaffected", () =>
      run(async (db) => {
        useGlobal(db);
        const Doc = createModel("doc", { fields: { id: { type: "integer" }, data: { type: "json" } } });
        await syncModels();
        const values = [{ a: [1, { b: "x" }] }, [1, "2"], 7, false];
        await Doc.createMany(values.map((data) => ({ data })));
        expect((await Doc.find({}, { orderBy: "id" })).map((d) => d.data)).toEqual(values);
      }));
  });

  describe("date fields", () => {
    // SQLite only: there 0.1.0-0.1.2 left epoch ms in the column, which 0.1.3-0.1.5 couldn't read. On Postgres
    // the column is a real `date` (the pg driver turned the Date into a day on the way in), so nothing changed.
    it.runIf(dialect === "sqlite")("rows written by 0.1.0-0.1.2 (Date objects, stored as epoch ms) read back as calendar days", () =>
      run(async (db) => {
        useGlobal(db);
        const Event = createModel("event", { fields: { id: { type: "integer" }, on: { type: "date" } } });
        await syncModels();
        // What 0.1.0-0.1.2 sent for a `date` field: a Date. Knex binds it as epoch ms on SQLite.
        await db("event").insert([
          { id: 1, on: new Date("2024-02-02") }, // from a date string: UTC midnight
          { id: 2, on: new Date(2024, 1, 3) }, // from local components: local midnight
        ]);
        await Event.create({ id: 3, on: "2024-02-04" }); // what 0.1.3+ writes

        expect((await Event.find({}, { orderBy: "id" })).map((e) => e.on)).toEqual(["2024-02-02", "2024-02-03", "2024-02-04"]);
        const types = await db.raw("select typeof(\"on\") as t from event order by id");
        expect(types.map((r) => r.t)).toEqual(["integer", "integer", "text"]); // really the legacy layout
      }));

    it("grouping a date field by period works for text dates and legacy epoch-ms dates alike", () =>
      run(async (db) => {
        useGlobal(db);
        const Event = createModel("event", { fields: { id: { type: "integer" }, on: { type: "date" } } });
        await syncModels();
        await Event.createMany([{ on: "2024-03-15" }, { on: "2024-07-02" }, { on: "2024-07-30" }]);
        // On SQLite, a legacy epoch-ms row in the same column; on Postgres just one more day.
        await db("event").insert({ on: dialect === "sqlite" ? new Date("2024-03-01") : "2024-03-01" });

        const rows = await Event.aggregate({}, { groupBy: ["on:month"], aggregates: { n: "count" }, orderBy: "on_month" });
        expect(rows.map((r) => [r.on_month.toISOString(), r.n])).toEqual([
          ["2024-03-01T00:00:00.000Z", 2],
          ["2024-07-01T00:00:00.000Z", 2],
        ]);
        const weeks = await Event.aggregate([["id", "<=", 2]], { groupBy: ["on:week", "on:quarter"], aggregates: { n: "count" }, orderBy: "on_week" });
        expect(weeks.map((r) => [r.on_week.toISOString().slice(0, 10), r.on_quarter.toISOString().slice(0, 10)])).toEqual([
          ["2024-03-11", "2024-01-01"], // 2024-03-15 is a Friday
          ["2024-07-01", "2024-07-01"], // 2024-07-02 is a Tuesday
        ]);
      }));
  });

  it("the global transaction() still commits and rolls back around these paths", () =>
    run(async (db) => {
      useGlobal(db);
      const Doc = createModel("doc", { fields: { id: { type: "integer" }, data: { type: "json" } } });
      await syncModels();
      await transaction(async (trx) => {
        await Doc.create({ data: "kept" }, { trx });
      });
      await transaction(async (trx) => {
        await Doc.create({ data: "dropped" }, { trx });
        throw new Error("rollback");
      }).catch(() => {});
      expect((await Doc.find()).map((d) => d.data)).toEqual(["kept"]);
    }));
});
