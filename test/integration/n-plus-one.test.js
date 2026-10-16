import { describe, it, expect, vi, afterEach } from "vitest";
import { eachIsolatedDialect } from "../helpers/isolated-dialects.js";
import { makeApi, insertRows, seedConstrained, SURFACES } from "../helpers/select-fixture.js";
import { scanForNPlusOne, watchForNPlusOne, NPlusOneError } from "../../src/diagnostics/n-plus-one.js";
import { detectNPlusOne, assertNoNPlusOne, watchNPlusOne } from "../../src/global/index.js";

const MATRIX = eachIsolatedDialect().flatMap((dialect) =>
  SURFACES.map((surface) => ({ name: `${dialect.name} / ${surface}`, surface, run: dialect.run }))
);

/**
 * `seedConstrained` has 3 posts; this adds more so a loop is long enough to count. 8 posts in all,
 * the first two with comments, tags and authors.
 */
async function seedPosts(db) {
  await seedConstrained(db);
  await insertRows(db, "post", Array.from({ length: 5 }, (_, i) => ({ id: 10 + i, authorId: 1, title: `extra${i}` })));
}

describe.each(MATRIX)("N+1 detector - $name", ({ surface, run }) => {
  afterEach(() => vi.restoreAllMocks());

  /** The one detector API of each surface, so the same cases run against all three. */
  const detectors = (api, db) => ({
    detect: (fn, options) =>
      surface === "client" ? api.client.detectNPlusOne(fn, options) : surface === "global" ? detectNPlusOne(fn, options) : scanForNPlusOne(db, fn, options),
    assertNone: (fn, options) =>
      surface === "client" ? api.client.assertNoNPlusOne(fn, options) : surface === "global" ? assertNoNPlusOne(fn, options) : scanForNPlusOne(db, fn, options).then(({ result, findings }) => {
        if (findings.length) throw new NPlusOneError(findings);
        return result;
      }),
    watch: (options) => (surface === "client" ? api.client.watchNPlusOne(options) : surface === "global" ? watchNPlusOne(options) : watchForNPlusOne(db, options)),
  });

  const setup = (fn) =>
    run(async (db) => {
      const api = await makeApi(surface, db);
      await seedPosts(db);
      return fn({ api, db, post: api.handle("post"), ...detectors(api, db) });
    });
  const ids = [1, 2, 3, 10, 11, 12, 13, 14];

  describe("catches the real foot-guns", () => {
    it("a findOne per id", () =>
      setup(async ({ api, detect }) => {
        const { findings } = await detect(async () => {
          for (const id of ids) await api.findOne("post", { id });
        });
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({ statement: "select", count: 8 });
        expect(findings[0].shape).toMatch(/^select \* from [`"]post[`"] where [`"]id[`"] = \? limit \?$/);
      }));

    it("a load() per record - the pattern loadMany() replaces", () =>
      setup(async ({ api, post, detect }) => {
        const posts = await api.find("post", {}, { orderBy: "id" });
        const { findings } = await detect(async () => {
          for (const p of posts) await post.load(p, "author");
        });
        expect(findings).toHaveLength(1);
        expect(findings[0].count).toBe(8);
        expect(findings[0].shape).toMatch(/from [`"]author[`"] where [`"]id[`"] in \(\?\)/);
      }));

    it("parallel queries count too (Promise.all of one statement per id)", () =>
      setup(async ({ api, detect }) => {
        const { findings } = await detect(() => Promise.all(ids.map((id) => api.findOne("post", { id }))));
        expect(findings).toMatchObject([{ count: 8 }]);
      }));

    it("IN lists of different lengths are still one shape", () =>
      setup(async ({ api, detect }) => {
        const { findings } = await detect(async () => {
          for (let n = 1; n <= 6; n++) await api.find("comment", [["postId", "in", ids.slice(0, n)]]);
        });
        expect(findings).toMatchObject([{ count: 6 }]);
      }));
  });

  describe("stays quiet on the right way to do it", () => {
    it("find with `with`, loadMany, paginate, and per-parent limits", () =>
      setup(async ({ api, post, assertNone }) => {
        await assertNone(async () => {
          const posts = await api.find("post", {}, { orderBy: "id", with: { author: true, comments: { orderBy: "-likes", limit: 2, with: ["user"] }, tags: { orderBy: "name", limit: 2 } } });
          expect(posts).toHaveLength(8);
          await post.loadMany(posts, "pinned");
          await post.paginate({}, { page: 2, perPage: 3, with: ["author"] });
        });
      }));

    it("many pages in a row is a repeated statement by nature - the threshold is the escape hatch", () =>
      setup(async ({ post, detect }) => {
        const paginateAll = async () => {
          for (let page = 1; page <= 6; page++) await post.paginate({}, { page, perPage: 2, total: false });
        };
        // Honest: it IS the same query repeatedly. (5, not 6: page 1 has offset 0, which is left out of the SQL, so it is a different shape.)
        expect((await detect(paginateAll)).findings).toMatchObject([{ statement: "select", count: 5 }]);
        expect((await detect(paginateAll, { threshold: 10 })).findings).toEqual([]);
      }));

    it("a handful of repeats stays under the threshold", () =>
      setup(async ({ api, detect }) => {
        const { findings } = await detect(async () => {
          for (const id of ids.slice(0, 4)) await api.findOne("post", { id });
        });
        expect(findings).toEqual([]);
      }));

    it("a loop of writes isn't flagged unless you ask for it - and sequence upkeep never is", () =>
      setup(async ({ post, detect }) => {
        // Explicit ids: on Postgres each insert is preceded by the ORM's `select setval(...)`, which must not count as a repeated read.
        let nextId = 200;
        const make = async () => {
          for (let i = 0; i < 6; i++) await post.create({ id: nextId++, title: `new${i}`, authorId: 1 });
        };
        expect((await detect(make)).findings).toEqual([]);
        const asked = await detect(make, { statements: ["insert"] });
        expect(asked.findings).toMatchObject([{ statement: "insert", count: 6 }]);
      }));
  });

  describe("options and cleanup", () => {
    it("threshold is yours to set", () =>
      setup(async ({ api, detect }) => {
        const loop = async () => {
          for (const id of ids.slice(0, 3)) await api.findOne("post", { id });
        };
        expect((await detect(loop)).findings).toEqual([]);
        expect((await detect(loop, { threshold: 3 })).findings).toMatchObject([{ count: 3 }]);
      }));

    it("assertNoNPlusOne returns what fn returned when clean, and throws the findings when not", () =>
      setup(async ({ api, assertNone }) => {
        expect(await assertNone(async () => (await api.findOne("post", { id: 1 })).id)).toBe(1);

        const error = await assertNone(async () => {
          for (const id of ids) await api.findOne("post", { id });
        }).catch((e) => e);
        expect(error).toBeInstanceOf(NPlusOneError);
        expect(error.findings[0].count).toBe(8);
        expect(error.message).toMatch(/Possible N\+1.*8 x select/s);
      }));

    it("detaches its listener after the scope, even if the code under test throws", () =>
      setup(async ({ db, api, detect }) => {
        const before = db.listenerCount("query");
        await detect(async () => api.findOne("post", { id: 1 }));
        expect(db.listenerCount("query")).toBe(before);
        await expect(detect(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
        expect(db.listenerCount("query")).toBe(before);
      }));

    it("sees queries made inside a transaction", () =>
      setup(async ({ api, db, detect, post }) => {
        const loop = async (find) => {
          for (const id of ids) await find(id);
        };
        const inTransaction =
          surface === "client"
            ? () => api.client.transaction((tx) => tx.detectNPlusOne(() => loop((id) => tx.models.post.findOne({ id }))))
            : () => detect(() => db.transaction((trx) => loop((id) => post.findOne({ id }, { trx }))));
        const { findings } = await inTransaction();
        expect(findings).toMatchObject([{ count: 8 }]);
      }));
  });

  describe("the live watcher", () => {
    it("calls onDetect once, as soon as a shape repeats, and stops when detached", () =>
      setup(async ({ api, db, watch }) => {
        const onDetect = vi.fn();
        const before = db.listenerCount("query");
        const monitor = watch({ onDetect, threshold: 5 });
        for (const id of ids) await api.findOne("post", { id });
        expect(onDetect).toHaveBeenCalledTimes(1);
        expect(onDetect.mock.calls[0][0]).toMatchObject({ count: 5, statement: "select" });

        monitor.detach();
        expect(db.listenerCount("query")).toBe(before);
        for (const id of ids) await api.findOne("post", { id });
        expect(onDetect).toHaveBeenCalledTimes(1);
      }));

    it("warns on the console by default", () =>
      setup(async ({ api, watch }) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const monitor = watch();
        for (const id of ids) await api.findOne("post", { id });
        monitor.detach();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toMatch(/Possible N\+1: the same statement ran repeatedly/);
      }));
  });
});
