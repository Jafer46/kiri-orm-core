import { normalizeDateColumns } from "../schema/normalize-dates.js";
import { getConnection } from "./connect.js";
import { state } from "./state.js";

/**
 * Rewrites `date` values written by 0.1.0-0.1.2 (epoch milliseconds on SQLite) as "YYYY-MM-DD"
 * text, for every model created with createModel() - or only `options.models`. Since 0.1.7.
 * See normalizeDateColumns() for the details; on Postgres it does nothing and returns [].
 *
 * @param {{ models?: string[] }} [options]
 * @returns {Promise<import('../schema/normalize-dates.js').NormalizedDateColumn[]>}
 */
export async function normalizeDates(options = {}) {
  return normalizeDateColumns(getConnection(), state.registry, options);
}
