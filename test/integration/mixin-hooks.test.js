import { describe, it, expect, beforeEach } from "vitest";
import { eachIsolatedDialect } from "../helpers/isolated-dialects.js";
import { connect, createModel, defineMixin, extendModel, syncModels, __resetGlobalStateForTests } from "../../src/global/index.js";

describe.each(eachIsolatedDialect())("mixin hooks - $name", ({ run }) => {
  beforeEach(() => __resetGlobalStateForTests());

  it("apply to a model that declares the mixin, running before the model's own hooks of the same name", () =>
    run(async (db) => {
      connect(db);
      const log = [];
      defineMixin("stamped", {
        fields: { createdBy: { type: "char" } },
        hooks: { beforeCreate: (data) => log.push(`mixin ${data.id}`) },
      });
      const Invoice = createModel("invoice", {
        mixins: ["stamped"],
        fields: { id: { type: "integer", required: true } },
        hooks: { beforeCreate: (data) => log.push(`own ${data.id}`) },
      });
      await syncModels();
      await Invoice.create({ id: 1, createdBy: "ada" });
      expect(log).toEqual(["mixin 1", "own 1"]);
    }));

  it("reach every model using the mixin, independently", () =>
    run(async (db) => {
      connect(db);
      const log = [];
      defineMixin("stamped", { fields: { createdBy: { type: "char" } }, hooks: { beforeCreate: () => log.push("fired") } });
      const Invoice = createModel("invoice", { mixins: ["stamped"], fields: { id: { type: "integer", required: true } } });
      const Customer = createModel("customer", { mixins: ["stamped"], fields: { id: { type: "integer", required: true } } });
      await syncModels();
      await Invoice.create({ id: 1 });
      await Customer.create({ id: 1 });
      expect(log).toEqual(["fired", "fired"]);
    }));

  it("support multiple hook handlers and array-form handlers, same as a model's own hooks", () =>
    run(async (db) => {
      connect(db);
      const log = [];
      defineMixin("audited", {
        fields: { note: { type: "char" } },
        hooks: { beforeCreate: [(d) => log.push("a"), (d) => log.push("b")] },
      });
      extendModel("audited", { hooks: { beforeCreate: (d) => log.push("c") } }); // extendModel accumulates onto an existing mixin's hooks
      const M = createModel("m", { mixins: ["audited"], fields: { id: { type: "integer", required: true } } });
      await syncModels();
      await M.create({ id: 1 });
      expect(log).toEqual(["a", "b", "c"]);
    }));

  it("compose through nested mixins, in depth-first order", () =>
    run(async (db) => {
      connect(db);
      const log = [];
      defineMixin("timestamped", { fields: { at: { type: "datetime" } }, hooks: { beforeCreate: () => log.push("timestamped") } });
      defineMixin("audited", { mixins: ["timestamped"], fields: { by: { type: "char" } }, hooks: { beforeCreate: () => log.push("audited") } });
      const Invoice = createModel("invoice", {
        mixins: ["audited"],
        fields: { id: { type: "integer", required: true } },
        hooks: { beforeCreate: () => log.push("invoice") },
      });
      await syncModels();
      await Invoice.create({ id: 1 });
      expect(log).toEqual(["timestamped", "audited", "invoice"]);
    }));

  it("extendModel on a mixin, called before a NEW dependent is created, reaches that dependent", () =>
    run(async (db) => {
      connect(db);
      const log = [];
      defineMixin("stamped", { fields: { createdBy: { type: "char" } } });
      extendModel("stamped", { hooks: { afterCreate: (doc) => log.push(`after ${doc.id}`) } });

      const Ticket = createModel("ticket", { mixins: ["stamped"], fields: { id: { type: "integer", required: true } } });
      await syncModels();
      await Ticket.create({ id: 5 });
      expect(log).toEqual(["after 5"]);
    }));

  it("does NOT retroactively reach a model that already existed before the mixin was extended (documented scoping)", () =>
    run(async (db) => {
      connect(db);
      const log = [];
      defineMixin("stamped", { fields: { createdBy: { type: "char" } } });
      const Invoice = createModel("invoice", { mixins: ["stamped"], fields: { id: { type: "integer", required: true } } });
      await syncModels();

      extendModel("stamped", { hooks: { afterCreate: (doc) => log.push(`after ${doc.id}`) } }); // added AFTER Invoice already resolved
      await Invoice.create({ id: 1 });
      expect(log).toEqual([]); // Invoice never picked it up - it resolved before the hook existed
    }));

  it("still validates hook names on a mixin, the same as on a model", () => {
    expect(() => defineMixin("bad", { fields: { x: { type: "char" } }, hooks: { beforeNothing() {} } })).toThrow(/unknown hook "beforeNothing"/);
  });

  it("extendModel on an abstract name validates hook names too, and applies nothing if invalid", () =>
    run(async (db) => {
      connect(db);
      defineMixin("stamped", { fields: { createdBy: { type: "char" } } });
      expect(() => extendModel("stamped", { hooks: { beforeNothing() {} } })).toThrow(/unknown hook "beforeNothing"/);

      const Invoice = createModel("invoice", { mixins: ["stamped"], fields: { id: { type: "integer", required: true } } });
      await syncModels();
      await expect(Invoice.create({ id: 1 })).resolves.toBeTruthy(); // nothing broken by the rejected extension
    }));

  it("a mixin with no hooks at all is simply a no-op for hook-pulling", () =>
    run(async (db) => {
      connect(db);
      defineMixin("plain", { fields: { x: { type: "char" } } });
      const M = createModel("m", { mixins: ["plain"], fields: { id: { type: "integer", required: true } } });
      await syncModels();
      await expect(M.create({ id: 1 })).resolves.toMatchObject({ id: 1 });
    }));

  it("extendModel on a concrete model is unaffected by the mixin-routing check (still registers directly)", () =>
    run(async (db) => {
      connect(db);
      const log = [];
      const Post = createModel("post", { fields: { id: { type: "integer", required: true } } });
      extendModel("post", { hooks: { beforeCreate: () => log.push("extended") } });
      await syncModels();
      await Post.create({ id: 1 });
      expect(log).toEqual(["extended"]);
    }));
});
