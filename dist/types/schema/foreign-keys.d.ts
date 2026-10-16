/**
 * Schema-side helpers for foreign keys: the one knex call that declares them, and the order
 * tables must be created in so every foreign key points at a table that already exists.
 */
/**
 * Declares one foreign key on a Knex table builder (inside createTable or alterTable).
 * @param {import('knex').Knex.TableBuilder} table
 * @param {import('../relations/foreign-keys.js').ForeignKeySpec} fk
 */
export declare function addForeignKey(table: import('knex').Knex.TableBuilder, fk: import('../relations/foreign-keys.js').ForeignKeySpec): void;
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
export declare function planCreation(models: object[], foreignKeysFor: (model: object) => import('../relations/foreign-keys.js').ForeignKeySpec[]): {
    order: object[];
    inline: Map<string, object[]>;
    deferred: Array<{
        model: object;
        fk: object;
    }>;
};
