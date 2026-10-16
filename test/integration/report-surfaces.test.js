import { describe, it, expect, beforeEach } from "vitest";
import { eachIsolatedDialect } from "../helpers/isolated-dialects.js";
import { seedAgg, insertAgg, AGG_MODELS } from "../helpers/aggregate-fixture.js";
import { makeReportApi, SALES_BY_CUSTOMER, MONTHLY_SALES } from "../helpers/report-fixture.js";
import { createClient } from "../../src/client/create-client.js";
import { defineModule } from "../../src/client/module.js";
import { defineReport } from "../../src/reports/define-report.js";
import { ReportDefinitionError } from "../../src/reports/errors.js";
import { connect, createModel, createReport, syncModels, __resetGlobalStateForTests } from "../../src/global/index.js";

/** What differs between the APIs: how reports are registered, and how they follow a transaction. */
describe.each(eachIsolatedDialect())("reports on the client API - $name", ({ run }) => {
  it("client.reports lists, rejects unknown names, and is not part of client.models", () =>
    run(async (db) => {
      const { client } = await makeReportApi("client", db);
      expect(Object.keys(client.reports).sort()).toEqual(["monthlySales", "salesByCustomer"]);
      expect("salesByCustomer" in client.reports).toBe(true);
      expect(() => client.reports.nope).toThrow(/Unknown report "nope"\. Registered reports: salesByCustomer, monthlySales/);
      expect(() => client.models.salesByCustomer).toThrow(/salesByCustomer/); // not a model
      expect(client.reports.salesByCustomer).toBe(client.reports.salesByCustomer); // one handle per name
    }));

  it("a report follows client.transaction(): it sees the transaction's uncommitted writes, and a rollback undoes them", () =>
    run(async (db) => {
      const { client } = await makeReportApi("client", db);
      await seedAgg(db);
      const before = await client.reports.salesByCustomer.count();

      const error = await client
        .transaction(async (tx) => {
          await tx.models.order.create({ id: 99, customerId: 1, status: "paid", total: 5 });
          const rows = await tx.reports.salesByCustomer.find([["customerId", "=", 1]]);
          throw Object.assign(new Error("rollback"), { orders: rows[0].orders, count: await tx.reports.salesByCustomer.count() });
        })
        .catch((e) => e);

      expect(error.message).toBe("rollback");
      expect(error.orders).toBe(3); // Ada's two orders plus the one written inside the transaction
      expect(await client.reports.salesByCustomer.count()).toBe(before);
      expect((await client.reports.salesByCustomer.find([["customerId", "=", 1]]))[0].orders).toBe(2);
    }));

  it("createClient({ reports }) and a module's `reports` both register, and duplicates are refused", () =>
    run(async (db) => {
      const sales = defineReport("salesByCustomer", SALES_BY_CUSTOMER);
      const monthly = defineReport("monthlySales", MONTHLY_SALES);
      const config = db.client.config.client === "pg" ? { dialect: "postgres", connectionString: db.client.config.connection.connectionString ?? db.client.config.connection } : { dialect: "sqlite", filename: ":memory:" };

      // Only construction is checked here (it validates before connecting to anything real).
      const dummyModule = defineModule({ name: "analytics", models: AGG_MODELS, reports: [monthly] });
      expect(dummyModule.reports).toEqual([monthly]);
      expect(() => defineModule({ name: "bad", models: AGG_MODELS, reports: monthly })).toThrow(/must be an array/);

      const client = createClient(config.dialect === "sqlite" ? config : { dialect: "sqlite", filename: ":memory:" }, { reports: [sales], modules: [dummyModule] });
      expect(Object.keys(client.reports).sort()).toEqual(["monthlySales", "salesByCustomer"]);
      await client.close();

      expect(() => createClient({ dialect: "sqlite", filename: ":memory:" }, { models: AGG_MODELS, reports: [sales, sales] })).toThrow(/"salesByCustomer" is registered more than once/);
      expect(() => createClient({ dialect: "sqlite", filename: ":memory:" }, { models: AGG_MODELS, reports: [{ name: "x" }] })).toThrow(/defineReport/);
      expect(() => createClient({ dialect: "sqlite", filename: ":memory:" }, { modules: [defineModule({ name: "reports", models: AGG_MODELS, createService: () => ({}) })] })).toThrow(/collides with a built-in client property/);
    }));

  it("a report reads whatever the client's models describe, so a model defined by a module is reachable", () =>
    run(async (db) => {
      const { client } = await makeReportApi("client", db);
      await seedAgg(db);
      await insertAgg(db, "order", [{ id: 50, customerId: 2, status: "paid", total: 1000, qty: 1, shippingFee: 0 }]);
      expect((await client.reports.salesByCustomer.findOne()).customerId).toBe(2); // 1220 now beats Grace's 300
    }));
});

describe.each(eachIsolatedDialect())("reports on the global API - $name", ({ run }) => {
  beforeEach(() => __resetGlobalStateForTests());

  it("can be defined before the models they read exist", () =>
    run(async (db) => {
      connect(db);
      const early = createReport("early", { from: "order", fields: { status: true, n: { agg: "count" } } });
      for (const { name, ...definition } of AGG_MODELS) createModel(name, definition);
      await syncModels();
      await seedAgg(db);
      expect(await early.find()).toEqual([{ status: "cancelled", n: 1 }, { status: "paid", n: 5 }, { status: "refunded", n: 1 }]);
    }));

  it("a report whose model never gets defined says which models there are", () =>
    run(async (db) => {
      connect(db);
      createModel("customer", AGG_MODELS.find((m) => m.name === "customer"));
      const lost = createReport("lost", { from: "ghost", fields: { id: true } });
      await expect(lost.find()).rejects.toThrow(/ghost/);
    }));

  it("refuses a second report with the same name", () =>
    run(async (db) => {
      connect(db);
      createReport("twice", { from: "order", fields: { status: true } });
      expect(() => createReport("twice", { from: "order", fields: { status: true } })).toThrow(/already defined/);
    }));

  it("accepts { trx } like the model methods do", () =>
    run(async (db) => {
      const api = await makeReportApi("global", db);
      await seedAgg(db);
      const sales = api.report("salesByCustomer");
      const error = await db
        .transaction(async (trx) => {
          await insertAgg(trx, "order", [{ id: 99, customerId: 3, status: "paid", total: 700, qty: 1, shippingFee: 0 }]);
          throw Object.assign(new Error("rollback"), { top: await sales.findOne({}, { trx }) });
        })
        .catch((e) => e);
      expect(error.top).toMatchObject({ customerId: 3, revenue: 1000 }); // 300 + 700, seen inside the transaction
      expect((await sales.findOne()).revenue).toBe(300);
    }));
});

describe.each(eachIsolatedDialect())("report definitions are validated against the models on first use - $name", ({ run }) => {
  const registryOnly = (run, fn) =>
    run(async (db) => {
      const { registry } = await makeReportApi("repository", db);
      const { ReportHandle } = await import("../../src/reports/report-handle.js");
      const handleFor = (definition) => new ReportHandle(defineReport("r", definition), { db: () => { throw new Error("must fail before touching the database"); }, registry: () => registry });
      return fn(handleFor);
    });

  it("reports a bad path as a ReportDefinitionError that names the report and the option", () =>
    registryOnly(run, async (handleFor) => {
      const error = await handleFor({ from: "order", fields: { x: "items.sku", n: { agg: "count" } } }).find().catch((e) => e);
      expect(error).toBeInstanceOf(ReportDefinitionError);
      expect(error.message).toMatch(/^Report "r": groupBy: groupBy "items\.sku": "items" is a hasMany \(to-many\) relation/);
      expect(error.cause.name).toBe("ValidationError");
    }));

  it.each([
    [{ from: "ghost", fields: { id: true } }, /ghost/],
    [{ from: "order", fields: { nope: true } }, /unknown field "nope" on model "order"/],
    [{ from: "order", fields: { n: { agg: "sum", of: "status" } } }, /sum needs an integer or float field, but "status" is char/],
    [{ from: "order", fields: { total: { agg: "sum", of: "total" } } }, /already a field/], // a report field can't be named like a model field it isn't
    [{ from: "order", fields: { label: true } }, /computed field/],
    [{ from: "order", fields: { m: { from: "status", bucket: "month" } } }, /needs a date or datetime field/],
    [{ from: "order", fields: { status: true }, orderBy: "nope" }, /"nope" is not a column of this result/],
  ])("%j -> %s", (definition, pattern) =>
    registryOnly(run, async (handleFor) => {
      await expect(handleFor(definition).find()).rejects.toThrow(pattern);
    }));

  it("a valid report passes validation and runs", () =>
    run(async (db) => {
      const { report } = await makeReportApi("repository", db, { ok: { from: "order", fields: { status: true, n: { agg: "count" } } } });
      expect(report("ok").toSQL().sql).toMatch(/group by/i);
      expect(await report("ok").find()).toEqual([]); // validated, and runs against the (empty) table
    }));
});
