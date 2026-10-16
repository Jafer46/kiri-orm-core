/**
 * Creates the two internal metadata tables if they don't already
 * exist. Idempotent, same spirit as Phase 3's additive sync() - safe
 * to call on every sync().
 *
 * `_meta_models` - one row per registered model (name, resolved table
 * name, lifecycle timestamps).
 *
 * `_meta_fields` - one row per field on a model (name, resolved
 * column name, type, constraints, and the full field descriptor as
 * JSON for fidelity). Denormalizes the model name onto each row
 * (alongside the `model_id` FK) specifically so a flat query like
 * `SELECT * FROM _meta_fields WHERE model = 'invoice'` works without
 * a join - that ergonomic is the whole point of this phase.
 *
 * @param {import('knex').Knex} db
 */
export declare function ensureMetaTables(db: import('knex').Knex): Promise<void>;
