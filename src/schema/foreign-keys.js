/**
 * Schema-side helpers for foreign keys: the one knex call that declares them, and the order
 * tables must be created in so every foreign key points at a table that already exists.
 */

/**
 * Declares one foreign key on a Knex table builder (inside createTable or alterTable).
 * @param {import('knex').Knex.TableBuilder} table
 * @param {import('../relations/foreign-keys.js').ForeignKeySpec} fk
 */
export function addForeignKey(table, fk) {
  table.foreign(fk.column).references(fk.refColumn).inTable(fk.refTable).onDelete(fk.onDelete);
}

/**
 * Orders `models` for creation and decides which foreign keys go inline in each CREATE TABLE.
 *
 * A model is created once every table its keys point at (among `models`) already exists, so
 * the key can sit inside the CREATE TABLE. A key to the table itself (a tree: `parent_id`) is
 * always inline. A genuine cycle (a -> b -> a) has no such order: one table is created first
 * with the keys that can't be satisfied yet split off into `deferred`, to be added with
 * ALTER TABLE once everything exists.
 *
 * Models whose keys point at tables outside `models` (already in the database) are never held up.
 *
 * @param {object[]} models - descriptors to create, in the order to prefer when nothing constrains it
 * @param {(model: object) => import('../relations/foreign-keys.js').ForeignKeySpec[]} foreignKeysFor
 * @returns {{ order: object[], inline: Map<string, object[]>, deferred: Array<{ model: object, fk: object }> }}
 */
export function planCreation(models, foreignKeysFor) {
  const pending = new Set(models.map((m) => m.name));
  const byName = new Map(models.map((m) => [m.name, m]));
  const keys = new Map(models.map((m) => [m.name, foreignKeysFor(m)]));
  const tableToModel = new Map(models.map((m) => [m.tableName, m.name]));
  const order = [];
  const inline = new Map();
  const deferred = [];

  // a key is "waiting" while it points at another model of this batch that isn't created yet
  const waitingOn = (model, fk) => {
    const target = tableToModel.get(fk.refTable);
    return target !== undefined && target !== model.name && pending.has(target);
  };

  while (pending.size > 0) {
    let next = [...pending].map((n) => byName.get(n)).find((m) => keys.get(m.name).every((fk) => !waitingOn(m, fk)));
    if (!next) next = byName.get([...pending][0]); // a cycle: break it at the first table
    const ready = keys.get(next.name).filter((fk) => !waitingOn(next, fk));
    for (const fk of keys.get(next.name)) if (!ready.includes(fk)) deferred.push({ model: next, fk });
    inline.set(next.name, ready);
    order.push(next);
    pending.delete(next.name);
  }
  return { order, inline, deferred };
}
