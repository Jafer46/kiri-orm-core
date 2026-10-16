import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { eachIsolatedDialect } from "../helpers/isolated-dialects.js";
import { ModelRegistry } from "../../src/models/registry.js";
import { sync } from "../../src/schema/sync.js";
import { buildColumn } from "../../src/schema/build-column.js";
import { defaultColumnBuilderRegistry } from "../../src/schema/default-column-builders.js";
import { getModelMeta, getFieldsMeta } from "../../src/meta/query.js";
import { diffSchema } from "../../src/migrations/diff.js";
import { describePlan } from "../../src/migrations/describe.js";
import { generateMigration } from "../../src/migrations/generate.js";
import { renderMigrationSource } from "../../src/migrations/render.js";
import { MigrationSafetyError, MigrationStateError } from "../../src/migrations/errors.js";
import { MIGRATIONS_TABLE, generateMigrationFile, migrateUp, migrateDown, getMigrationStatus } from "../../src/migrations/runner.js";

const invoice = (extraFields = {}, table) => ({
  name: "invoice",
  ...(table ? { table } : {}),
  fields: { id: { type: "integer", required: true }, ...extraFields },
});
const registryOf = (...models) => {
  const registry = new ModelRegistry();
  for (const model of models) registry.define(model);
  return registry;
};

async function withDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "orm-migrations-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const columnsOf = async (db, table) => Object.keys(await db(table).columnInfo()).sort();
const fieldNames = async (db, model) => (await getFieldsMeta(db, model)).map((f) => f.name);

describe.each(eachIsolatedDialect())("migration runner - $name", ({ run }) => {
  it("generate -> up -> generate finds nothing -> down -> generate finds the change again", () =>
    run((db) =>
      withDir(async (dir) => {
        const registry = registryOf(invoice({ total: { type: "float" } }));

        const first = await generateMigrationFile(db, registry, { dir });
        expect(first.summary).toEqual(['[safe]        create model "invoice"']);
        expect(first.file).toMatch(/\d{14}_create_invoice\.js$/);
        expect(await getModelMeta(db, "invoice")).toBeUndefined(); // generating writes no metadata

        const up = await migrateUp(db, { dir });
        expect(up.applied).toEqual([first.name]);
        expect(await columnsOf(db, "invoice")).toEqual(["id", "total"]);
        expect(await fieldNames(db, "invoice")).toEqual(["id", "total"]); // metadata followed the schema
        expect((await db(MIGRATIONS_TABLE).select("name")).map((r) => r.name)).toEqual([first.name]);

        // The applied state is now the recorded state: nothing left to generate.
        const again = await generateMigrationFile(db, registry, { dir });
        expect(again.file).toBeNull();
        expect(again.summary).toEqual(["(no changes - registry matches the last synced state)"]);

        const down = await migrateDown(db, { dir });
        expect(down.rolledBack).toEqual([first.name]);
        expect(await db.schema.hasTable("invoice")).toBe(false);
        expect(await getModelMeta(db, "invoice")).toBeUndefined(); // metadata went back too
        expect(await db(MIGRATIONS_TABLE).count({ c: "*" }).then((r) => Number(r[0].c))).toBe(0);

        // The metadata is back to "invoice doesn't exist", so the registry differs from it again...
        expect(describePlan(await diffSchema(db, registry))).toEqual(['[safe]        create model "invoice"']);
        // ...and the rolled-back file is pending once more, which (correctly) blocks generating a duplicate.
        expect((await getMigrationStatus(db, dir)).pending.map((p) => p.name)).toEqual([first.name]);
        await expect(generateMigrationFile(db, registry, { dir })).rejects.toThrow(MigrationStateError);

        await rm(first.file); // discard it, and the same change generates afresh
        const regenerated = await generateMigrationFile(db, registry, { dir });
        expect(regenerated.summary).toEqual(['[safe]        create model "invoice"']);
      })
    ));

  it("carries a chain: add a field, roll back only that step, metadata follows each", () =>
    run((db) =>
      withDir(async (dir) => {
        const v1 = registryOf(invoice());
        const v2 = registryOf(invoice({ total: { type: "float" } }));

        await generateMigrationFile(db, v1, { dir });
        await migrateUp(db, { dir });
        const second = await generateMigrationFile(db, v2, { dir, name: "add total" });
        expect(second.summary).toEqual(['[safe]        invoice: add field "total"']);
        expect(second.name).toMatch(/_add_total$/);
        await migrateUp(db, { dir });
        expect(await columnsOf(db, "invoice")).toEqual(["id", "total"]);
        expect(await fieldNames(db, "invoice")).toEqual(["id", "total"]);

        await db("invoice").insert({ id: 1, total: 5 });
        const { rolledBack } = await migrateDown(db, { dir }); // one step by default
        expect(rolledBack).toEqual([second.name]);
        expect(await columnsOf(db, "invoice")).toEqual(["id"]);
        expect(await fieldNames(db, "invoice")).toEqual(["id"]);
        expect((await db("invoice").first()).id).toBe(1); // the first migration's table (and row) survive

        const plan = await diffSchema(db, v2);
        expect(plan.fieldChanges.invoice.addFields).toEqual(["total"]); // v2 is pending again, per the metadata
      })
    ));

  it("steps and all control how many migrations move", () =>
    run((db) =>
      withDir(async (dir) => {
        const stages = [registryOf(invoice()), registryOf(invoice({ a: { type: "float" } })), registryOf(invoice({ a: { type: "float" }, b: { type: "float" } }))];
        for (const registry of stages) {
          await generateMigrationFile(db, registry, { dir });
          await migrateUp(db, { dir });
        }
        expect((await getMigrationStatus(db, dir)).applied).toHaveLength(3);

        expect((await migrateDown(db, { dir, steps: 2 })).rolledBack).toHaveLength(2);
        expect(await columnsOf(db, "invoice")).toEqual(["id"]);
        expect((await migrateUp(db, { dir, steps: 1 })).applied).toHaveLength(1);
        expect((await getMigrationStatus(db, dir)).pending).toHaveLength(1);
        expect((await migrateDown(db, { dir, all: true })).rolledBack).toHaveLength(2); // the create + the one re-applied
        expect(await db.schema.hasTable("invoice")).toBe(false);
        expect((await migrateDown(db, { dir })).rolledBack).toEqual([]); // nothing left, not an error
      })
    ));

  it("refuses destructive changes unless allowed, and refuses type changes always", () =>
    run((db) =>
      withDir(async (dir) => {
        await generateMigrationFile(db, registryOf(invoice({ total: { type: "float" } })), { dir });
        await migrateUp(db, { dir });

        const dropTotal = registryOf(invoice());
        const blocked = await generateMigrationFile(db, dropTotal, { dir }).catch((e) => e);
        expect(blocked).toBeInstanceOf(MigrationSafetyError);
        expect(blocked.planLines.join("\n")).toMatch(/DESTRUCTIVE.*drop field "total"/);
        expect((await readdir(dir)).length).toBe(1); // nothing written

        const typeChange = registryOf(invoice({ total: { type: "integer" } }));
        await expect(generateMigrationFile(db, typeChange, { dir, allowDestructive: true })).rejects.toThrow(MigrationSafetyError);

        const allowed = await generateMigrationFile(db, dropTotal, { dir, allowDestructive: true });
        await migrateUp(db, { dir });
        expect(await columnsOf(db, "invoice")).toEqual(["id"]);
        await migrateDown(db, { dir }); // recreates the column's shape
        expect(await columnsOf(db, "invoice")).toEqual(["id", "total"]);
        expect(allowed.summary.join("\n")).toMatch(/DESTRUCTIVE/);
      })
    ));

  it("dryRun reports the plan and writes nothing", () =>
    run((db) =>
      withDir(async (dir) => {
        const result = await generateMigrationFile(db, registryOf(invoice()), { dir, dryRun: true });
        expect(result.summary).toEqual(['[safe]        create model "invoice"']);
        expect(result.file).toBeNull();
        expect(await readdir(dir)).toEqual([]);
        expect(await getModelMeta(db, "invoice")).toBeUndefined(); // and the dry-run's metadata sync was rolled back
      })
    ));

  it("resolves renames the caller names, table renames and column renames included", () =>
    run((db) =>
      withDir(async (dir) => {
        await generateMigrationFile(db, registryOf(invoice({ total: { type: "float" } })), { dir });
        await migrateUp(db, { dir });
        await db("invoice").insert({ id: 1, total: 9 });

        const renamed = registryOf(invoice({ amount: { type: "float" } }, "invoices"));
        const gen = await generateMigrationFile(db, renamed, { dir, fieldRenames: { invoice: { total: "amount" } } });
        expect(gen.summary.join("\n")).toMatch(/rename table "invoice" -> "invoices"/);
        expect(gen.summary.join("\n")).toMatch(/rename field "total" -> "amount"/);
        await migrateUp(db, { dir });

        expect((await db("invoices").first()).amount).toBe(9); // data followed the rename
        expect((await getModelMeta(db, "invoice")).table_name).toBe("invoices");
        expect((await generateMigrationFile(db, renamed, { dir })).file).toBeNull();

        await migrateDown(db, { dir });
        expect((await db("invoice").first()).total).toBe(9);
        expect((await getModelMeta(db, "invoice")).table_name).toBe("invoice");
      })
    ));

  it("runs each migration in one transaction: a failure leaves schema, metadata and history untouched", () =>
    run((db) =>
      withDir(async (dir) => {
        await generateMigrationFile(db, registryOf(invoice()), { dir });
        await migrateUp(db, { dir });

        await writeFile(
          join(dir, "29990101000000_half_done.js"),
          `export const summary = ["adds a column, then fails"];
export async function up(db) {
  await db.schema.alterTable("invoice", (t) => t.integer("extra"));
  throw new Error("boom halfway");
}
export async function down() {}
export const meta = {};
`
        );
        await expect(migrateUp(db, { dir })).rejects.toThrow("boom halfway");
        expect(await columnsOf(db, "invoice")).toEqual(["id"]); // the ALTER was rolled back with it
        expect((await getMigrationStatus(db, dir)).pending.map((p) => p.name)).toEqual(["29990101000000_half_done"]);
      })
    ));

  it("stops when the files and the history disagree", () =>
    run((db) =>
      withDir(async (dir) => {
        const first = await generateMigrationFile(db, registryOf(invoice()), { dir });

        // pending migrations block generating another
        await expect(generateMigrationFile(db, registryOf(invoice({ a: { type: "float" } })), { dir })).rejects.toThrow(MigrationStateError);
        await expect(generateMigrationFile(db, registryOf(invoice({ a: { type: "float" } })), { dir })).rejects.toThrow(/have not been applied yet/);

        await migrateUp(db, { dir });

        // a new file older than the latest applied one
        await writeFile(join(dir, "20000101000000_too_old.js"), "export async function up(){}\nexport async function down(){}\n");
        await expect(migrateUp(db, { dir })).rejects.toThrow(/sort before the latest applied/);
        await rm(join(dir, "20000101000000_too_old.js"));

        // an applied migration whose file has gone missing
        await rm(first.file);
        await expect(migrateDown(db, { dir })).rejects.toThrow(/recorded as applied but their files are missing/);
      })
    ));

  it("does not mistake relations (stored in _meta_fields) for removed fields", () =>
    run((db) =>
      withDir(async (dir) => {
        const withRelations = (extra = {}) =>
          registryOf(
            {
              name: "post",
              fields: { id: { type: "integer", required: true }, authorId: { type: "integer" }, ...extra },
              relations: {
                comments: { type: "hasMany", model: "comment", foreignKey: "postId" },
                author: { type: "belongsTo", model: "author", foreignKey: "authorId" },
                tags: { type: "belongsToMany", model: "tag", through: "post_tag", foreignKey: "post_id", otherKey: "tag_id" },
              },
            },
            { name: "comment", fields: { id: { type: "integer" }, postId: { type: "integer" } } },
            { name: "author", fields: { id: { type: "integer" } } },
            { name: "tag", fields: { id: { type: "integer" } } }
          );

        // After a plain sync() the recorded state includes relation rows; there is nothing to migrate.
        await sync(db, withRelations());
        const none = await generateMigrationFile(db, withRelations(), { dir });
        expect(none.file).toBeNull();
        expect(none.summary).toEqual(["(no changes - registry matches the last synced state)"]);

        // A real change alongside relations is reported alone: no phantom drops of "comments"/"author"/"tags".
        const change = await generateMigrationFile(db, withRelations({ title: { type: "char" } }), { dir });
        expect(change.summary).toEqual(['[safe]        post: add field "title"']);
      })
    ));

  it("rolls back a dropped model that had relations without trying to build columns for them", () =>
    run((db) =>
      withDir(async (dir) => {
        const both = registryOf(
          { name: "post", fields: { id: { type: "integer" } }, relations: { comments: { type: "hasMany", model: "comment", foreignKey: "postId" } } },
          { name: "comment", fields: { id: { type: "integer" }, postId: { type: "integer" } } }
        );
        await sync(db, both);
        const withoutPost = registryOf({ name: "comment", fields: { id: { type: "integer" }, postId: { type: "integer" } } });

        const gen = await generateMigrationFile(db, withoutPost, { dir, allowDestructive: true });
        expect(gen.summary).toEqual(['[DESTRUCTIVE] drop model "post" (table "post") - all rows will be lost']);
        await migrateUp(db, { dir });
        expect(await db.schema.hasTable("post")).toBe(false);
        await migrateDown(db, { dir });
        expect(await columnsOf(db, "post")).toEqual(["id"]); // just the column, not a "comments" column
      })
    ));

  it("ensures pivot tables for belongsToMany relations when given the registry", () =>
    run((db) =>
      withDir(async (dir) => {
        const registry = registryOf(
          { name: "post", fields: { id: { type: "integer", required: true } }, relations: { tags: { type: "belongsToMany", model: "tag", through: "post_tag", foreignKey: "post_id", otherKey: "tag_id" } } },
          { name: "tag", fields: { id: { type: "integer", required: true } } }
        );
        await generateMigrationFile(db, registry, { dir });
        const result = await migrateUp(db, { dir, modelRegistry: registry });
        expect(result.pivotTablesCreated).toEqual(["post_tag"]);
        expect(await db.schema.hasTable("post_tag")).toBe(true);
        expect((await migrateUp(db, { dir, modelRegistry: registry })).pivotTablesCreated).toEqual([]);
      })
    ));

  it("orders same-second generations correctly instead of colliding", () =>
    run((db) =>
      withDir(async (dir) => {
        const a = await generateMigrationFile(db, registryOf(invoice()), { dir, name: "same" });
        await migrateUp(db, { dir });
        const b = await generateMigrationFile(db, registryOf(invoice({ x: { type: "float" } })), { dir, name: "same" });
        expect(b.name > a.name).toBe(true);
      })
    ));
});

describe.each(eachIsolatedDialect())("rendered migration files behave like generateMigration() closures - $name", ({ run }) => {
  // The file renderer and the in-memory generator are separate code paths
  // over the same plan; this pins them together on every kind of change.
  async function schemaOf(db) {
    const out = {};
    for (const table of ["invoice", "invoices", "customer"]) {
      if (await db.schema.hasTable(table)) out[table] = Object.keys(await db(table).columnInfo()).sort();
    }
    return out;
  }

  async function scenario(db, before, after, options = {}) {
    await sync(db, before);
    const plan = await diffSchema(db, after, options.diff);

    const closure = generateMigration(plan, after, { allowDestructive: true });
    await closure.up(db);
    const viaClosureUp = await schemaOf(db);
    await closure.down(db);
    const viaClosureDown = await schemaOf(db);

    return withDir(async (dir) => {
      const file = join(dir, "m.mjs");
      await writeFile(file, renderMigrationSource(plan, after, { allowDestructive: true }));
      const mod = await import(pathToFileURL(file).href);
      const helpers = { buildColumn, columnBuilderRegistry: defaultColumnBuilderRegistry };

      await mod.up(db, helpers);
      expect(await schemaOf(db)).toEqual(viaClosureUp);
      await mod.down(db, helpers);
      expect(await schemaOf(db)).toEqual(viaClosureDown);
      expect(mod.summary).toEqual(closure.summary);
      return { viaClosureUp, viaClosureDown };
    });
  }

  it("create model + add field", () =>
    run(async (db) => {
      const before = registryOf(invoice());
      const after = registryOf(invoice({ total: { type: "float", index: true }, note: { type: "char", maxLength: 20, unique: true } }), { name: "customer", fields: { id: { type: "integer" }, name: { type: "char", required: true } } });
      const { viaClosureUp } = await scenario(db, before, after);
      expect(viaClosureUp.customer).toEqual(["id", "name"]);
      expect(viaClosureUp.invoice).toEqual(["id", "note", "total"]);
    }));

  it("table rename + column rename + field rename", () =>
    run(async (db) => {
      const before = registryOf(invoice({ total: { type: "float" } }));
      const after = registryOf(invoice({ amount: { type: "float" } }, "invoices"));
      const { viaClosureUp } = await scenario(db, before, after, { diff: { fieldRenames: { invoice: { total: "amount" } } } });
      expect(viaClosureUp.invoices).toEqual(["amount", "id"]);
    }));

  it("drop field + drop model", () =>
    run(async (db) => {
      const before = registryOf(invoice({ total: { type: "float" } }), { name: "customer", fields: { id: { type: "integer" } } });
      const after = registryOf(invoice());
      const { viaClosureUp, viaClosureDown } = await scenario(db, before, after);
      expect(viaClosureUp.customer).toBeUndefined();
      expect(viaClosureDown.customer).toEqual(["id"]);
    }));
});
