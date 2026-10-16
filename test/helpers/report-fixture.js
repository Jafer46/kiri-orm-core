import { ModelRegistry } from "../../src/models/registry.js";
import { sync } from "../../src/schema/sync.js";
import { OrmClient } from "../../src/client/orm-client.js";
import { HookRegistry } from "../../src/uow/hooks.js";
import { defineReport } from "../../src/reports/define-report.js";
import { ReportHandle } from "../../src/reports/report-handle.js";
import { connect, createModel, createReport, syncModels, __resetGlobalStateForTests } from "../../src/global/index.js";
import { AGG_MODELS } from "./aggregate-fixture.js";

/**
 * Report definitions over the aggregate fixture (see aggregate-fixture.js for the data). Written so
 * the expected rows can be checked by eye:
 *
 *   salesByCustomer - non-cancelled orders, one row per customer:
 *       Ada   (UK)   2 orders  revenue 150  items 150   avg 75
 *       Alan  (UK)   2 orders  revenue 220  items 200   avg 110      (order 7 has no items)
 *       Grace (US)   1 order   revenue 300  items 300   avg 300      (order 4 is cancelled)
 *       -            1 order   revenue  10  items null  avg 10       (order 5 has no customer)
 *   monthlySales - every order, one row per month of placedAt.
 */
export const SALES_BY_CUSTOMER = {
  from: "order",
  where: [["status", "!=", "cancelled"]],
  fields: {
    customerId: true,
    customerName: "customer.name",
    country: "customer.company.country",
    orders: { agg: "count" },
    revenue: { agg: "sum", of: "total" },
    itemsTotal: { agg: "sum", of: "items.amount" },
    avgOrder: { compute: (row) => (row.orders ? row.revenue / row.orders : null), depends: ["orders", "revenue"] },
  },
  orderBy: "-revenue",
};

export const MONTHLY_SALES = {
  from: "order",
  fields: {
    month: { from: "placedAt", bucket: "month" },
    orders: { agg: "count" },
    revenue: { agg: "sum", of: "total" },
    buyers: { agg: "countDistinct", of: "customerId" },
    biggest: { agg: "max", of: "total" },
  },
};

export const REPORT_DEFINITIONS = { salesByCustomer: SALES_BY_CUSTOMER, monthlySales: MONTHLY_SALES };
export const REPORT_SURFACES = ["repository", "client", "global"];

/**
 * `api.report(name)` returns the report's handle for that surface: a bare ReportHandle, `client.reports.*`,
 * or the object `createReport()` returned. `api.client` / `api.db` are there for the tests that need them.
 */
export async function makeReportApi(surface, db, definitions = REPORT_DEFINITIONS) {
  if (surface === "global") {
    __resetGlobalStateForTests();
    connect(db);
    // Reports first, models after: a report must not need its models to exist when it is defined.
    const handles = Object.fromEntries(Object.entries(definitions).map(([name, def]) => [name, createReport(name, def)]));
    for (const { name, ...definition } of AGG_MODELS) createModel(name, definition);
    await syncModels();
    return { surface, db, report: (name) => handles[name] };
  }

  const registry = new ModelRegistry();
  for (const model of AGG_MODELS) registry.define(model);
  await sync(db, registry);
  const descriptors = Object.entries(definitions).map(([name, def]) => defineReport(name, def));

  if (surface === "client") {
    const client = new OrmClient(db, registry, new HookRegistry(), undefined, [], descriptors);
    return { surface, db, client, registry, report: (name) => client.reports[name] };
  }
  const handles = Object.fromEntries(descriptors.map((d) => [d.name, new ReportHandle(d, { db: () => db, registry: () => registry })]));
  return { surface, db, registry, report: (name) => handles[name] };
}
