import { sync } from "../schema/sync.js";
import { getConnection } from "./connect.js";
import { state } from "./state.js";

/**
 * Syncs every model defined via `createModel()` against the default
 * connection - tables, meta-tables, and belongsToMany pivot tables
 * (Phases 3/4/7's `sync()`, run against the default registry).
 *
 * Always an explicit call, never implicit - same principle as `sync()`
 * everywhere else in this ORM: schema changes are something the
 * caller chooses to run, not something that happens as a side effect
 * of defining a model or making a query.
 */
export async function syncModels() {
  return sync(getConnection(), state.registry);
}
