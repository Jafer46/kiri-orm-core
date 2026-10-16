/**
 * The foreign keys a migration plan has to create, worked out once so the in-memory
 * migration (generate.js) and the rendered file (render.js) agree:
 *
 *   creation  new models in dependency order, with the keys that go inside each CREATE TABLE
 *             (`inline`) and the few that can't (a cycle) added afterwards (`deferred`)
 *   added     per existing model, the keys belonging to columns this migration adds
 *
 * Keys on columns that already exist are not part of a plan: the diff only sees fields.
 * (`sync({ addMissingForeignKeys: true })` is the way to add those.)
 *
 * @param {import('./diff.js').DiffPlan} plan
 * @param {import('../models/registry.js').ModelRegistry} modelRegistry
 */
export declare function planMigrationForeignKeys(plan: import('./diff.js').DiffPlan, modelRegistry: import('../models/registry.js').ModelRegistry): {
    creation: {
        order: object[];
        inline: Map<string, object[]>;
        deferred: Array<{
            model: object;
            fk: object;
        }>;
    };
    added: {};
};
/** The source line for one foreign key, as written into a rendered migration file. */
export declare const renderForeignKey: (fk: any) => string;
