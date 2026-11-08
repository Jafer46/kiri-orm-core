import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  connect,
  createModel,
  syncModels,
  transaction,
  normalizeDates,
  getConnection,
  disconnect,
} from "../../src/global/index.js";
import { __resetGlobalStateForTests } from "../../src/global/state.js";
import { createConnection, closeConnection } from "../../src/connection.js";
import { ModelRegistry } from "../../src/models/registry.js";
import { Repository } from "../../src/crud/repository.js";
import { UnitOfWork } from "../../src/uow/unit-of-work.js";
import { sync } from "../../src/schema/sync.js";
import { migrateUp, migrateDown, MIGRATIONS_TABLE } from "../../src/migrations/runner.js";
import { Command } from "../../src/relations/commands.js";
import { TransactionDeadlockError } from "../../src/dialect/transaction-guard.js";
import { IN_LIST_CHUNK } from "../../src/crud/chunk.js";
import { eachIsolatedDialect } from "../helpers/isolated-dialects.js";

/**
 * Regression tests for 0.1.7, each written against the bug as users hit it, through the global
 * createModel() API where the bug is reachable there. Postgres runs when TEST_PG_CONNECTION_STRING is set.
 */
const useGlobal = (db) => {
  __resetGlobalStateForTests();
  connect(db);
};
const count = async (db, table) => Number((await db(table).count("* as c"))[0].c);
const execFileAsync = promisify(execFile);
const range = (n) => Array.from({ length: n }, (_, i) => i);

// Past SQLite's 32,766 bound-parameter cap (Postgres' is 65,535), and several IN_LIST_CHUNKs.
const MANY = 33_000;

describe.each(eachIsolatedDialect())("0.1.7 regressions - $name", ({ name: dialect, run }) => {
  describe("a query outside the open transaction it runs in", () => {
    const Account = () => createModel("account", { fields: { id: { type: "integer" }, balance: { type: "integer" } } });

    it.runIf(dialect === "sqlite")("fails at once with TransactionDeadlockError instead of hanging for 60 s", () =>
      run(async (db) => {
        useGlobal(db);
        const A = Account();
        await syncModels();
        const started = Date.now();
        const error = await transaction(async (trx) => {
          await A.create({ balance: 1 }, { trx });
          return A.count(); // forgot { trx }
        }).catch((e) => e);
        expect(error).toBeInstanceOf(TransactionDeadlockError);
        expect(Date.now() - started).toBeLessThan(2000);
        expect(await A.count()).toBe(0); // the transaction rolled back
      }));

    it.runIf(dialect === "sqlite")("a hook that queries during a nested create fails at once too", () =>
      run(async (db) => {
        useGlobal(db);
        const Audit = createModel("audit", { fields: { id: { type: "integer" }, msg: { type: "char" } } });
        const Order = createModel("order", {
          fields: { id: { type: "integer" } },
          relations: { items: { type: "hasMany", model: "item", foreignKey: "orderId" } },
        });
        createModel("item", {
          fields: { id: { type: "integer" }, orderId: { type: "integer" } },
          relations: { order: { type: "belongsTo", model: "order", foreignKey: "orderId" } },
          hooks: { beforeCreate: async () => void (await Audit.create({ msg: "item" })) },
        });
        await syncModels();
        const error = await Order.create({ items: [Command.create({})] }).catch((e) => e);
        expect(error).toBeInstanceOf(TransactionDeadlockError);
        expect(await Order.count()).toBe(0);
      }));

    it("queries from other requests still wait their turn and succeed", () =>
      run(async (db) => {
        useGlobal(db);
        const A = Account();
        await syncModels();
        let release;
        const gate = new Promise((resolve) => (release = resolve));
        const inTransaction = transaction(async (trx) => {
          await A.create({ balance: 1 }, { trx });
          await gate;
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
        const fromElsewhere = A.count(); // not inside the transaction's async flow
        setTimeout(release, 50);
        await inTransaction;
        // SQLite: it waited for the commit. Postgres: it ran on another connection, before or after.
        if (dialect === "sqlite") expect(await fromElsewhere).toBe(1);
        else expect([0, 1]).toContain(await fromElsewhere);
      }));

    it("passing { trx } works, and Postgres keeps running non-trx queries on another connection", () =>
      run(async (db) => {
        useGlobal(db);
        const A = Account();
        await syncModels();
        const seen = await transaction(async (trx) => {
          await A.create({ balance: 1 }, { trx });
          const inside = await A.count({}, { trx });
          const outside = dialect === "postgres" ? await A.count() : null;
          return { inside, outside };
        });
        expect(seen).toEqual({ inside: 1, outside: dialect === "postgres" ? 0 : null });
      }));
  });

  describe("relations", () => {
    it("concurrent attach() of the same pairs succeeds once, without errors", () =>
      run(async (db) => {
        useGlobal(db);
        const Post = createModel("post", {
          fields: { id: { type: "integer" } },
          relations: { tags: { type: "belongsToMany", model: "tag", through: "post_tag", foreignKey: "postId", otherKey: "tagId" } },
        });
        const Tag = createModel("tag", { fields: { id: { type: "integer" } } });
        await syncModels();
        const post = await Post.create({});
        const tags = await Tag.createMany([{}, {}, {}]);
        const ids = tags.map((t) => t.id);
        const results = await Promise.all(range(5).map(() => Post.attach(post, "tags", ids)));
        expect(results.reduce((a, b) => a + b, 0)).toBe(3);
        expect(await count(db, "post_tag")).toBe(3);
      }));

    it("belongsToMany between uuid-keyed models: pivot columns match the keys", () =>
      run(async (db) => {
        useGlobal(db);
        const Post = createModel("post", {
          fields: { id: { type: "uuid" }, title: { type: "char" } },
          relations: { tags: { type: "belongsToMany", model: "tag", through: "post_tag", foreignKey: "postId", otherKey: "tagId" } },
        });
        const Tag = createModel("tag", { fields: { id: { type: "uuid" }, name: { type: "char" } } });
        await syncModels();
        const post = await Post.create({ title: "a" });
        const [x, y] = await Tag.createMany([{ name: "x" }, { name: "y" }]);
        expect(await Post.attach(post, "tags", [x.id, y.id])).toBe(2);
        const [loaded] = await Post.find({}, { with: { tags: { orderBy: "name" } } });
        expect(loaded.tags.map((t) => t.name)).toEqual(["x", "y"]);
        expect(await Post.detach(post, "tags", x.id)).toBe(1);
        if (dialect === "postgres") {
          const types = await db("information_schema.columns").where({ table_name: "post_tag" }).select("column_name", "data_type");
          expect(types.map((c) => c.data_type)).toEqual(["uuid", "uuid"]);
        }
      }));

    it(`find({ with }) over ${MANY} parents (hasMany, belongsTo, belongsToMany) loads every relation`, () =>
      run(async (db) => {
        useGlobal(db);
        const Author = createModel("author", {
          fields: { id: { type: "integer" }, n: { type: "integer" } },
          relations: {
            books: { type: "hasMany", model: "book", foreignKey: "authorId" },
            tags: { type: "belongsToMany", model: "tag", through: "author_tag", foreignKey: "authorId", otherKey: "tagId" },
          },
        });
        const Book = createModel("book", {
          fields: { id: { type: "integer" }, authorId: { type: "integer" } },
          relations: { author: { type: "belongsTo", model: "author", foreignKey: "authorId" } },
        });
        const Tag = createModel("tag", { fields: { id: { type: "integer" }, name: { type: "char" } } });
        await syncModels();
        await Author.createMany(range(MANY).map((n) => ({ n })));
        await Book.createMany(range(MANY).map((i) => ({ authorId: i + 1 })));
        const [tagA, tagB] = await Tag.createMany([{ name: "a" }, { name: "b" }]);
        await Author.attachMany("tags", range(MANY).map((i) => ({ source: i + 1, targets: i % 2 ? [tagA.id, tagB.id] : [tagA.id] })));

        const authors = await Author.find({}, { orderBy: "id", with: ["books", "tags"] });
        expect(authors).toHaveLength(MANY);
        expect(authors.every((a) => a.books.length === 1 && a.books[0].authorId === a.id)).toBe(true);
        expect(authors.every((a) => a.tags.length === (a.id % 2 === 0 ? 2 : 1))).toBe(true);

        const books = await Book.find({}, { with: ["author"] });
        expect(books.every((b) => b.author?.id === b.authorId)).toBe(true);

        // Ordered and limited many-to-many takes the joined path: per-author results must hold across chunks.
        const limited = await Author.find({}, { orderBy: "id", with: { tags: { orderBy: [["name", "desc"]], limit: 1 } } });
        expect(limited.at(-1).tags.map((t) => t.name)).toEqual([limited.at(-1).id % 2 === 0 ? "b" : "a"]);
        expect(limited.filter((a) => a.tags[0]?.name === "b")).toHaveLength(Math.floor(MANY / 2));
      }), 120_000);

    it(`cascade (constraint: false) through ${MANY} children, and detach() of ${MANY} targets`, () =>
      run(async (db) => {
        useGlobal(db);
        const Owner = createModel("owner", {
          fields: { id: { type: "integer" } },
          relations: { tags: { type: "belongsToMany", model: "label", through: "owner_label", foreignKey: "ownerId", otherKey: "labelId" } },
        });
        const Pet = createModel("pet", {
          fields: { id: { type: "integer" }, ownerId: { type: "integer" } },
          relations: { owner: { type: "belongsTo", model: "owner", foreignKey: "ownerId", onDelete: "cascade", constraint: false } },
        });
        const Label = createModel("label", { fields: { id: { type: "integer" } } });
        await syncModels();
        const [keep, gone] = await Owner.createMany([{}, {}]);
        await Pet.createMany([...range(MANY).map(() => ({ ownerId: gone.id })), { ownerId: keep.id }]);

        expect(await Owner.deleteMany({ id: gone.id })).toBe(1);
        expect(await count(db, "pet")).toBe(1);

        const labels = await Label.createMany(range(MANY).map(() => ({})));
        await Owner.attach(keep, "tags", labels.map((l) => l.id));
        expect(await Owner.detach(keep, "tags", labels.map((l) => l.id))).toBe(MANY);
        expect(await count(db, "owner_label")).toBe(0);
      }), 120_000);
  });

  describe("unit of work and bulk create", () => {
    it("UnitOfWork returns one object per row for a model without a primary key", () =>
      run(async (db) => {
        const registry = new ModelRegistry();
        registry.define({ name: "kv", fields: { k: { type: "char" }, v: { type: "char" } } });
        await sync(db, registry);
        await new Repository(db, registry.getModel("kv"), undefined, registry).createMany([{ k: "a" }, { k: "b" }]);
        const rows = await new UnitOfWork(db, registry).find("kv", {}, { orderBy: "k" });
        expect(rows.map((r) => r.k)).toEqual(["a", "b"]);
        expect(rows[0]).not.toBe(rows[1]);
      }));

    it("createMany() of rows with no values (only an auto id, or every field unset)", () =>
      run(async (db) => {
        useGlobal(db);
        const OnlyId = createModel("only_id", { fields: { id: { type: "integer" } } });
        const Optional = createModel("optional", { fields: { id: { type: "integer" }, note: { type: "char" } } });
        await syncModels();
        expect((await OnlyId.createMany([{}, {}, {}])).map((r) => r.id)).toEqual([1, 2, 3]);
        expect((await Optional.createMany([{}, {}])).map((r) => [r.id, r.note])).toEqual([[1, null], [2, null]]);
        expect((await Optional.createMany([{}, { note: "x" }])).map((r) => r.note)).toEqual([null, "x"]);
      }));
  });

  describe("migrations from two processes at once", () => {
    const SLOW_MIGRATION =
      `export async function up(db) {\n  await new Promise((r) => setTimeout(r, 300));\n` +
      `  await db.schema.createTable("slow_t", (t) => { t.increments("id"); });\n  await db("slow_t").insert({});\n}\n` +
      `export async function down(db) { await db.schema.dropTable("slow_t"); }\n`;

    // Two app instances deploying together, on a fresh database. Postgres: two independent pools.
    // SQLite: two real processes - better-sqlite3 waits for a lock synchronously, so two connections
    // in one process would block each other in a way two processes never do.
    const both = async (direction, { a, b, dir, filename }) => {
      if (!filename) return direction === "up" ? Promise.all([migrateUp(a, { dir }), migrateUp(b, { dir })]) : Promise.all([migrateDown(a, { dir }), migrateDown(b, { dir })]);
      const worker = fileURLToPath(new URL("../helpers/migrate-worker.mjs", import.meta.url));
      const outputs = await Promise.all([0, 1].map(() => execFileAsync(process.execPath, [worker, direction, dir, filename])));
      return outputs.map(({ stdout }) => JSON.parse(stdout));
    };

    it("apply (and roll back) each migration once: the second process waits, then skips it", () =>
      run(async (db, { openAnother }) => {
        const dir = mkdtempSync(join(tmpdir(), "kiri-mig-"));
        const filename = openAnother ? null : join(dir, "db.sqlite");
        const a = openAnother ? db : createConnection({ dialect: "sqlite", filename });
        const b = openAnother ? openAnother() : null;
        try {
          writeFileSync(join(dir, "20260101000000_slow.js"), SLOW_MIGRATION);
          const up = await both("up", { a, b, dir, filename });
          expect(up.flatMap((r) => r.applied ?? r)).toEqual(["20260101000000_slow"]);
          expect(await count(a, "slow_t")).toBe(1);
          expect(await count(a, MIGRATIONS_TABLE)).toBe(1);

          const down = await both("down", { a, b, dir, filename });
          expect(down.flatMap((r) => r.rolledBack ?? r)).toEqual(["20260101000000_slow"]);
          expect(await a.schema.hasTable("slow_t")).toBe(false);
        } finally {
          if (filename) await closeConnection(a);
          rmSync(dir, { recursive: true, force: true });
        }
      }), 30_000);
  });

  describe("normalizeDates()", () => {
    it("rewrites legacy epoch-ms dates as text on SQLite (so filters and sorting work); a no-op on Postgres", () =>
      run(async (db) => {
        useGlobal(db);
        const Event = createModel("event", { fields: { id: { type: "integer" }, on: { type: "date" } } });
        await syncModels();
        // 0.1.0-0.1.2 layout on SQLite: a Date, bound as epoch ms. On Postgres, already a real date.
        await db("event").insert(
          dialect === "sqlite" ? [{ on: new Date("2024-03-01") }, { on: new Date(2024, 0, 5) }] : [{ on: "2024-03-01" }, { on: "2024-01-05" }]
        );
        await Event.create({ on: "2024-02-10" });

        const report = await normalizeDates();
        if (dialect === "sqlite") {
          expect(report).toEqual([{ model: "event", field: "on", table: "event", column: "on", rows: 2 }]);
          const types = await db.raw(`select typeof("on") as t from event order by id`);
          expect(types.map((r) => r.t)).toEqual(["text", "text", "text"]);
        } else {
          expect(report).toEqual([]);
        }
        const found = await Event.find([["on", ">=", "2024-02-01"]], { orderBy: "on" });
        expect(found.map((e) => e.on)).toEqual(["2024-02-10", "2024-03-01"]);
        expect(await normalizeDates()).toEqual([]); // nothing left to do
      }));
  });
});

describe("connections", () => {
  it("connect() closes the pool it created before, once its queries finish; a pool you passed is left open", async () => {
    __resetGlobalStateForTests();
    const first = connect({ dialect: "sqlite", filename: ":memory:" });
    const running = first.transaction(async (trx) => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return (await trx.raw("select 1 as ok"))[0].ok;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = connect({ dialect: "sqlite", filename: ":memory:" });
    expect(await running).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(first.client.pool).toBeFalsy(); // destroyed
    expect(getConnection()).toBe(second);

    const mine = createConnection({ dialect: "sqlite", filename: ":memory:" });
    connect(mine);
    connect({ dialect: "sqlite", filename: ":memory:" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect((await mine.raw("select 2 as ok"))[0].ok).toBe(2); // still open
    await closeConnection(mine);
    await disconnect();
  });

  it("createConnection() passes pool, acquireConnectionTimeout and ssl through", async () => {
    let created = 0;
    const db = createConnection({
      dialect: "sqlite",
      filename: ":memory:",
      acquireConnectionTimeout: 1234,
      pool: { afterCreate: (conn, done) => { created++; done(null, conn); } },
    });
    expect(db.client.config.acquireConnectionTimeout).toBe(1234);
    expect((await db.raw("PRAGMA foreign_keys"))[0].foreign_keys).toBe(1); // the ORM's own afterCreate still runs
    expect(created).toBe(1);
    await closeConnection(db);

    const pg = createConnection({ dialect: "postgres", connectionString: "postgres://u@localhost/x", ssl: { rejectUnauthorized: false }, pool: { min: 0, max: 3 } });
    expect(pg.client.config.connection).toEqual({ connectionString: "postgres://u@localhost/x", ssl: { rejectUnauthorized: false } });
    expect(pg.client.pool.max).toBe(3);
    await closeConnection(pg);
  });

  it("IN_LIST_CHUNK stays well under both databases' bound-parameter limits", () => {
    expect(IN_LIST_CHUNK).toBeLessThan(32_766 / 2);
  });
});
