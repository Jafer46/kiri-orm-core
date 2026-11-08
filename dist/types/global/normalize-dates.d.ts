/**
 * Rewrites `date` values written by 0.1.0-0.1.2 (epoch milliseconds on SQLite) as "YYYY-MM-DD"
 * text, for every model created with createModel() - or only `options.models`. Since 0.1.7.
 * See normalizeDateColumns() for the details; on Postgres it does nothing and returns [].
 *
 * @param {{ models?: string[] }} [options]
 * @returns {Promise<import('../schema/normalize-dates.js').NormalizedDateColumn[]>}
 */
export declare function normalizeDates(options?: {
    models?: string[];
}): Promise<import('../schema/normalize-dates.js').NormalizedDateColumn[]>;
