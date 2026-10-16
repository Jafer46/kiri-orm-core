import { ReportHandle } from "../reports/report-handle.js";
/**
 * Defines a report on the global API and returns its handle: a read-only, transient model
 * whose rows are summaries - group keys plus aggregates - computed in ONE SQL statement. It has no
 * table, is never synced or migrated, and is not part of the model registry.
 *
 * ```js
 * export const SalesByCustomer = createReport("salesByCustomer", {
 *   from: "order",
 *   where: [["status", "!=", "cancelled"]],
 *   fields: {
 *     customerId:   true,
 *     customerName: "customer.name",
 *     orders:       { agg: "count" },
 *     revenue:      { agg: "sum", of: "total" },
 *     items:        { agg: "sum", of: "items.qty" },
 *   },
 *   orderBy: "-revenue",
 * });
 *
 * await SalesByCustomer.find([["revenue", ">", 1000]], { limit: 10 });
 * await SalesByCustomer.count();
 * ```
 *
 * See defineReport() for what a definition may contain. The models it reads need not exist yet
 * (they are looked up on first use), so reports can live in their own files.
 *
 * @param {string} name
 * @param {object} definition
 * @returns {ReportHandle}
 */
export declare function createReport(name: string, definition: object): ReportHandle;
