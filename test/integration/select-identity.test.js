import { describe, it, expect } from "vitest";
import { eachIsolatedDialect } from "../helpers/isolated-dialects.js";
import { captureQueries } from "../helpers/sql-capture.js";
import { makeApi, seed } from "../helpers/select-fixture.js";
import { withIdentityMap } from "../../src/global/index.js";

const keys = (obj) => Object.keys(obj).sort();

/**
 * Partial documents meet the identity map: the same row can be read narrowly one moment and
 * fully the next, and both reads must resolve to the SAME object without losing unsaved edits
 * or marking freshly loaded fields as changed. Only the tracked APIs have an identity map.
 */
const MATRIX = eachIsolatedDialect().flatMap((dialect) =>
  ["client", "global"].map((surface) => ({ name: `${dialect.name} / ${surface}`, surface, run: dialect.run }))
);

describe.each(MATRIX)("select + identity map - $name", ({ surface, run }) => {
  // The global API only has an identity map inside withIdentityMap(); the client always has one.
  const setup = (fn) =>
    run(async (db) => {
      const api = await makeApi(surface, db);
      await seed(db);
      return surface === "global" ? withIdentityMap(() => fn(api, db)) : fn(api, db);
    });

  it("a partial read followed by a full read is the same object, now complete and not dirty", () =>
    setup(async (api, db) => {
      const partial = await api.findOne("post", { id: 1 }, { select: ["title"] });
      expect(keys(partial)).toEqual(["id", "title"]);

      const full = await api.findOne("post", { id: 1 });
      expect(full).toBe(partial);
      expect(keys(full)).toEqual(["authorId", "body", "id", "meta", "publishedAt", "status", "title", "views"]);
      expect(full.meta).toEqual({ a: 1 });

      // The fields that arrived late start out clean: nothing to write.
      const { queries } = await captureQueries(db, () => full.save());
      expect(queries).toHaveLength(0);
    }));

  it("a full read followed by a partial read is the same object and keeps every field", () =>
    setup(async (api) => {
      const full = await api.findOne("post", { id: 1 });
      const partial = await api.findOne("post", { id: 1 }, { select: ["title"] });
      expect(partial).toBe(full);
      expect(keys(partial)).toEqual(["authorId", "body", "id", "meta", "publishedAt", "status", "title", "views"]);
    }));

  it("an unsaved edit survives a later full read, and only that edit is written", () =>
    setup(async (api, db) => {
      const doc = await api.findOne("post", { id: 1 }, { select: ["title"] });
      doc.title = "edited";

      const again = await api.findOne("post", { id: 1 });
      expect(again).toBe(doc);
      expect(again.title).toBe("edited"); // the in-memory value wins over what's in the database
      expect(again.views).toBe(10); // ...while the fields it lacked were filled in

      const { queries } = await captureQueries(db, () => doc.save());
      const update = queries.find(({ sql }) => /^\s*update/i.test(sql));
      expect(update.sql).toMatch(/title/);
      expect(update.sql).not.toMatch(/views|body|status/);
      expect((await db("post").where({ id: 1 }).first()).title).toBe("edited");
    }));

  it("two different partial reads of one row accumulate on one object", () =>
    setup(async (api) => {
      const a = await api.findOne("post", { id: 2 }, { select: ["title"] });
      const b = await api.findOne("post", { id: 2 }, { select: ["views", "status"] });
      expect(b).toBe(a);
      expect(keys(a)).toEqual(["id", "status", "title", "views"]);
    }));

  it("saving a partially loaded document changes only what was edited; unloaded columns are untouched", () =>
    setup(async (api, db) => {
      const doc = await api.findOne("post", { id: 1 }, { select: ["title"] });
      doc.title = "only-this";
      await doc.save();

      const row = await db("post").where({ id: 1 }).first();
      expect(row.title).toBe("only-this");
      expect(row.body).toBe("b1");
      expect(row.views).toBe(10);
      expect(row.status).toBe("published");
    }));

  it("a partially loaded document can be deleted (its primary key is always read)", () =>
    setup(async (api, db) => {
      const doc = await api.findOne("post", { id: 4 }, { select: ["title"] });
      await doc.delete();
      expect(await db("post").where({ id: 4 }).first()).toBeUndefined();
    }));

  it("computed fields appear once their dependencies have been loaded, and track edits", () =>
    setup(async (api) => {
      const narrow = await api.findOne("author", { id: 1 }, { select: ["email"] });
      expect("fullName" in narrow).toBe(false);

      const wider = await api.findOne("author", { id: 1 }, { select: ["fullName"] });
      expect(wider).toBe(narrow);
      expect(narrow.fullName).toBe("Ada Lovelace");
      expect("initials" in narrow).toBe(false); // never requested

      narrow.firstName = "Augusta";
      expect(narrow.fullName).toBe("Augusta Lovelace"); // live, like any computed field
    }));

  it("a full read after a partial one defines every computed field", () =>
    setup(async (api) => {
      const narrow = await api.findOne("author", { id: 2 }, { select: ["email"] });
      const full = await api.findOne("author", { id: 2 });
      expect(full).toBe(narrow);
      expect([full.fullName, full.initials, full.badge, full.always]).toEqual(["Alan Turing", "AT", "[Alan Turing]", "const"]);
    }));

  it("eager-loaded relations are refreshed on every read, with the selection of that read", () =>
    setup(async (api) => {
      const first = await api.findOne("post", { id: 1 }, { select: ["title"], with: { author: { select: ["email"] } } });
      expect(keys(first.author)).toEqual(["email"]);

      const second = await api.findOne("post", { id: 1 }, { select: ["title"], with: { author: { select: ["bio"] } } });
      expect(second).toBe(first);
      expect(keys(second.author)).toEqual(["bio"]);
    }));

  it("a join key hidden from the result is not leaked onto the tracked document either", () =>
    setup(async (api) => {
      const doc = await api.findOne("post", { id: 1 }, { select: ["title"], with: { author: { select: ["email"] } } });
      expect(keys(doc)).toEqual(["author", "id", "title"]);
      expect("authorId" in doc).toBe(false);
    }));

  it("select on a changed primary key is still refused (immutability holds for partial documents)", () =>
    setup(async (api) => {
      const doc = await api.findOne("post", { id: 3 }, { select: ["title"] });
      doc.id = 99;
      await expect(doc.save()).rejects.toThrow(/primary key/);
    }));
});
