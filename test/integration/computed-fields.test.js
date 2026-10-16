import { describe, it, expect, beforeEach } from "vitest";
import { eachIsolatedDialect } from "../helpers/isolated-dialects.js";
import { ModelRegistry } from "../../src/models/registry.js";
import { sync } from "../../src/schema/sync.js";
import { OrmClient } from "../../src/client/orm-client.js";
import { HookRegistry } from "../../src/uow/hooks.js";
import { RepositoryFactory } from "../../src/crud/repository-factory.js";
import { ValidationError } from "../../src/crud/errors.js";
import { DomainValidationError } from "../../src/domain/errors.js";
import { diffSchema } from "../../src/migrations/diff.js";
import { getFieldsMeta } from "../../src/meta/query.js";
import { generateDTOSchemas } from "../../src/dto/schema-generator.js";
import { connect, createModel, syncModels, withIdentityMap, __resetGlobalStateForTests } from "../../src/global/index.js";

// "Ada Lovelace" -> two stored-field conditions. Written once, used by every test below.
const splitName = (value) => {
  const [first, ...rest] = String(value).split(" ");
  return [first, rest.join(" ")];
};

const PERSON = {
  name: "person",
  fields: {
    id: { type: "integer", required: true },
    firstName: { type: "char", required: true },
    lastName: { type: "char", required: true },
    age: { type: "integer", required: true },

    fullName: {
      type: "char",
      depends: ["firstName", "lastName"],
      compute: (r) => `${r.firstName} ${r.lastName}`,
      search: (op, value) => {
        if (op === "=") {
          const [first, last] = splitName(value);
          return [["firstName", "=", first], ["lastName", "=", last]];
        }
        if (op === "ilike" || op === "like") return ["|", ["firstName", op, value], ["lastName", op, value]];
        throw new Error(`fullName can't be searched with "${op}"`);
      },
    },

    // A boolean derived from a stored field: searchable because each answer maps to a range on `age`.
    isAdult: {
      type: "boolean",
      depends: ["age"],
      compute: (r) => r.age >= 18,
      search: (op, value) => {
        const wantAdult = op === "=" ? value : !value;
        return [["age", wantAdult ? ">=" : "<", 18]];
      },
    },

    // Depends on another computed field, and is searched by delegating to it.
    shout: {
      type: "char",
      depends: ["fullName"],
      compute: (r) => r.fullName.toUpperCase(),
      search: (op, value) => [["fullName", op, value]],
    },

    // The value is cast to the field's type BEFORE search() sees it.
    nextAge: { type: "integer", depends: ["age"], compute: (r) => r.age + 1, search: (op, value) => [["age", op, value - 1]] },

    // Readable but deliberately not searchable, and two broken searches.
    initials: { type: "char", depends: ["firstName", "lastName"], compute: (r) => `${r.firstName[0]}${r.lastName[0]}` },
    badSearch: { type: "char", compute: () => "x", search: () => "not a domain" },
    loopA: { type: "char", compute: () => "x", search: (op, v) => [["loopB", op, v]] },
    loopB: { type: "char", compute: () => "x", search: (op, v) => [["loopA", op, v]] },
    hidden: { type: "char", compute: () => "secret", expose: false },
  },
  relations: { articles: { type: "hasMany", model: "article", foreignKey: "authorId" } },
};
const ARTICLE = {
  name: "article",
  fields: { id: { type: "integer", required: true }, authorId: { type: "integer" }, title: { type: "char" } },
  relations: { author: { type: "belongsTo", model: "person", foreignKey: "authorId" } },
};

const PEOPLE = [
  { id: 1, firstName: "Ada", lastName: "Lovelace", age: 36 },
  { id: 2, firstName: "Alan", lastName: "Turing", age: 41 },
  { id: 3, firstName: "Grace", lastName: "Hopper", age: 85 },
  { id: 4, firstName: "Kid", lastName: "Coder", age: 12 },
];

async function setup(db) {
  const registry = new ModelRegistry();
  registry.define(PERSON);
  registry.define(ARTICLE);
  await sync(db, registry);
  const client = new OrmClient(db, registry, new HookRegistry());
  await client.models.person.createMany(PEOPLE);
  await client.models.article.createMany([
    { id: 1, authorId: 1, title: "Notes on the Analytical Engine" },
    { id: 2, authorId: 2, title: "On Computable Numbers" },
    { id: 3, authorId: 3, title: "COBOL" },
  ]);
  return { registry, client };
}

const ids = (rows) => rows.map((r) => r.id).sort((a, b) => a - b);

describe.each(eachIsolatedDialect())("computed fields: reading - $name", ({ run }) => {
  it("appear on everything read: find, findOne, create, createMany, plain Repository records, JSON", () =>
    run(async (db) => {
      const { client, registry } = await setup(db);

      const found = await client.models.person.findOne({ id: 1 });
      expect(found.fullName).toBe("Ada Lovelace");
      expect(found.isAdult).toBe(true);
      expect(found.shout).toBe("ADA LOVELACE"); // computed from another computed field
      expect(found.nextAge).toBe(37);

      const created = await client.models.person.create({ id: 10, firstName: "Linus", lastName: "T", age: 17 });
      expect([created.fullName, created.isAdult]).toEqual(["Linus T", false]);
      const [many] = await client.models.person.createMany([{ id: 11, firstName: "Ken", lastName: "T", age: 30 }]);
      expect(many.fullName).toBe("Ken T");

      const plain = await new RepositoryFactory(db, registry).for("person").findOne({ id: 2 });
      expect(plain.fullName).toBe("Alan Turing"); // a plain record, not an entity
      expect(JSON.parse(JSON.stringify(found))).toMatchObject({ id: 1, fullName: "Ada Lovelace", isAdult: true });
    }));

  it("appear on eager-loaded related records", () =>
    run(async (db) => {
      const { client } = await setup(db);
      const article = await client.models.article.findOne({ id: 2 }, { with: ["author"] });
      expect(article.author.fullName).toBe("Alan Turing");

      const author = await client.models.person.findOne({ id: 1 }, { with: ["articles"] });
      expect(author.articles).toHaveLength(1);
    }));

  it("have no column: sync creates none, records none in the metadata, and the schema diff stays empty", () =>
    run(async (db) => {
      const { registry } = await setup(db);
      const columns = Object.keys(await db("person").columnInfo()).sort();
      expect(columns).toEqual(["age", "first_name", "id", "last_name"]);

      const recorded = (await getFieldsMeta(db, "person")).map((f) => f.name).sort();
      expect(recorded).toEqual(["age", "articles", "firstName", "id", "lastName"]); // fields + the relation; no computed

      expect((await diffSchema(db, registry)).createModels).toEqual([]);
      expect(Object.keys((await diffSchema(db, registry)).fieldChanges)).toEqual([]);
    }));
});

describe.each(eachIsolatedDialect())("computed fields: entities - $name", ({ run }) => {
  it("follow in-memory edits, are never dirty, and save() writes only stored fields", () =>
    run(async (db) => {
      const { client } = await setup(db);
      const ada = await client.models.person.findOne({ id: 1 });

      ada.firstName = "Augusta";
      expect(ada.fullName).toBe("Augusta Lovelace"); // reflected immediately, before saving
      ada.age = 10;
      expect(ada.isAdult).toBe(false);

      await ada.save();
      const row = await db("person").where({ id: 1 }).first();
      expect(row).toMatchObject({ first_name: "Augusta", age: 10 });
      expect(Object.keys(row)).not.toContain("full_name");
      expect((await client.models.person.findOne({ id: 1 })).fullName).toBe("Augusta Lovelace");
    }));

  it("are read-only, with a message that says so", () =>
    run(async (db) => {
      const { client } = await setup(db);
      const ada = await client.models.person.findOne({ id: 1 });
      expect(() => {
        ada.fullName = "Someone Else";
      }).toThrow(/"fullName" is a computed field on model "person" and is read-only/);
    }));

  it("can't be written through create() or updateMany() either", () =>
    run(async (db) => {
      const { client } = await setup(db);
      const err = await client.models.person.create({ id: 20, firstName: "A", lastName: "B", age: 1, fullName: "X Y" }).catch((e) => e);
      expect(err).toBeInstanceOf(ValidationError);
      expect(err.fieldErrors.fullName[0]).toMatch(/is a computed field on model "person" and can't be written/);

      const update = await client.models.person.updateMany({ id: 1 }, { fullName: "X Y" }).catch((e) => e);
      expect(update).toBeInstanceOf(ValidationError);
      expect(update.fieldErrors.fullName[0]).toMatch(/computed field/);
    }));
});

describe.each(eachIsolatedDialect())("computed fields: filtering by them - $name", ({ run }) => {
  it("an equality filter object may name a computed field, alone or with stored ones", () =>
    run(async (db) => {
      const { client } = await setup(db);
      expect(ids(await client.models.person.find({ fullName: "Alan Turing" }))).toEqual([2]);
      expect(ids(await client.models.person.find({ fullName: "Alan Turing", age: 41 }))).toEqual([2]);
      expect(ids(await client.models.person.find({ fullName: "Alan Turing", age: 99 }))).toEqual([]);
      expect(ids(await client.models.person.find({ isAdult: false }))).toEqual([4]);
    }));

  it("a domain may use any operator the field's search() supports", () =>
    run(async (db) => {
      const { client } = await setup(db);
      expect(ids(await client.models.person.find([["fullName", "ilike", "%RA%"]]))).toEqual([3]); // Grace
      expect(ids(await client.models.person.find([["fullName", "like", "A%"]]))).toEqual([1, 2]); // Ada, Alan
      expect(ids(await client.models.person.find([["isAdult", "!=", true]]))).toEqual([4]);
      expect(ids(await client.models.person.find([["isAdult", "=", true]]))).toEqual([1, 2, 3]);
    }));

  it("an operator search() doesn't support is the search function's own error", () =>
    run(async (db) => {
      const { client } = await setup(db);
      await expect(client.models.person.find([["fullName", ">", "M"]])).rejects.toThrow('fullName can\'t be searched with ">"');
    }));

  it("combines with stored fields and with AND / OR / NOT, staying correctly grouped", () =>
    run(async (db) => {
      const { client } = await setup(db);
      // The computed leaf expands to (firstName like ... OR lastName like ...); NOT/OR must wrap all of it.
      expect(ids(await client.models.person.find(["!", ["fullName", "like", "A%"]]))).toEqual([3, 4]);
      expect(ids(await client.models.person.find(["|", ["fullName", "=", "Grace Hopper"], ["age", "<", 20]]))).toEqual([3, 4]);
      expect(ids(await client.models.person.find([["fullName", "like", "A%"], ["isAdult", "=", true], ["age", ">", 40]]))).toEqual([2]);
      expect(ids(await client.models.person.find(["&", ["isAdult", "=", true], ["!", ["fullName", "=", "Ada Lovelace"]]]))).toEqual([2, 3]);
    }));

  it("casts the value to the computed field's type before search() sees it", () =>
    run(async (db) => {
      const { client } = await setup(db);
      // "42" (a string) -> 42 (an integer) -> age = 41
      expect(ids(await client.models.person.find([["nextAge", "=", "42"]]))).toEqual([2]);
      expect(ids(await client.models.person.find([["isAdult", "=", "false"]]))).toEqual([4]); // "false" -> false
    }));

  it("a computed field whose search() filters on another computed field works, to any depth", () =>
    run(async (db) => {
      const { client } = await setup(db);
      expect(ids(await client.models.person.find([["shout", "ilike", "%turing%"]]))).toEqual([2]); // shout -> fullName -> firstName/lastName
    }));

  it("works across relations: a computed field on the related model, from either side", () =>
    run(async (db) => {
      const { client } = await setup(db);
      expect(ids(await client.models.article.find([["author.fullName", "=", "Grace Hopper"]]))).toEqual([3]);
      expect(ids(await client.models.article.find([["author.fullName", "like", "A%"]]))).toEqual([1, 2]);
      expect(ids(await client.models.article.find([["author.isAdult", "=", false]]))).toEqual([]); // the child has no articles
      expect(ids(await client.models.person.find([["articles.title", "like", "COBOL%"]]))).toEqual([3]);
    }));

  it("applies to updateMany and deleteMany, so it can target rows, and still refuses an empty filter", () =>
    run(async (db) => {
      const { client } = await setup(db);
      expect(await client.models.person.updateMany({ fullName: "Alan Turing" }, { age: 50 })).toBe(1);
      expect((await db("person").where({ id: 2 }).first()).age).toBe(50); // (updateMany bypasses the client's identity map, as documented)

      expect(await client.models.person.deleteMany([["isAdult", "=", false]])).toBe(1);
      expect(ids(await client.models.person.find())).toEqual([1, 2, 3]);
      await expect(client.models.person.deleteMany({})).rejects.toThrow();
    }));

  it("says why a computed field with no search() can't be filtered on", () =>
    run(async (db) => {
      const { client } = await setup(db);
      expect((await client.models.person.findOne({ id: 1 })).initials).toBe("AL"); // readable
      const err = await client.models.person.find([["initials", "=", "AL"]]).catch((e) => e);
      expect(err).toBeInstanceOf(DomainValidationError);
      expect(err.message).toMatch(/"initials" on model "person" is computed and can't be used in a domain.*`search\(operator, value\)`/);
    }));

  it("rejects a search() that doesn't return a domain, and searches that ask about each other", () =>
    run(async (db) => {
      const { client } = await setup(db);
      await expect(client.models.person.find([["badSearch", "=", "x"]])).rejects.toThrow(/must return a domain array.*got string/);
      await expect(client.models.person.find([["loopA", "=", "x"]])).rejects.toThrow(
        /Circular search on computed fields: person\.loopA -> person\.loopB -> person\.loopA/
      );
    }));

  it("lists computed fields among the known fields when a name is misspelled", () =>
    run(async (db) => {
      const { client } = await setup(db);
      await expect(client.models.person.find([["fullNmae", "=", "x"]])).rejects.toThrow(/Known fields:.*fullName/);
    }));
});

describe("computed fields: DTOs", () => {
  const model = (() => {
    const registry = new ModelRegistry();
    return registry.define(PERSON);
  })();

  it("appear in the read schema as read-only, and in neither create nor update", () => {
    const { create, update, read } = generateDTOSchemas(model);
    expect(read.properties.fullName).toEqual({ type: "string", readOnly: true });
    expect(read.properties.isAdult).toEqual({ type: "boolean", readOnly: true });
    expect(read.properties.nextAge).toEqual({ type: "integer", readOnly: true });
    expect(create.properties).not.toHaveProperty("fullName");
    expect(update.properties).not.toHaveProperty("fullName");
    expect(read.required ?? []).not.toContain("fullName"); // required lists stored columns only
  });

  it("honor expose: false", () => {
    expect(generateDTOSchemas(model).read.properties).not.toHaveProperty("hidden");
  });
});

describe.each(eachIsolatedDialect())("computed fields: the global createModel() API - $name", ({ run }) => {
  beforeEach(() => __resetGlobalStateForTests());

  it("work on documents, in filters, and inside an identity-map scope", () =>
    run(async (db) => {
      connect(db);
      const Person = createModel("person", { fields: PERSON.fields });
      await syncModels();
      await Person.createMany(PEOPLE);

      const [ada] = await Person.find({ fullName: "Ada Lovelace" });
      expect(ada.fullName).toBe("Ada Lovelace");
      expect(ids(await Person.find([["isAdult", "=", false]]))).toEqual([4]);

      await withIdentityMap(async () => {
        const first = await Person.findOne({ id: 2 });
        first.firstName = "Alan Mathison";
        const again = await Person.findOne({ id: 2 });
        expect(again).toBe(first);
        expect(again.fullName).toBe("Alan Mathison Turing"); // the shared instance's computed value follows its edits
      });
    }));
});
