import { Repository } from "./repository.js";
/**
 * Ties a `db` connection to a `ModelRegistry` and hands out a
 * `Repository` per model name, e.g.:
 *
 *   const repos = new RepositoryFactory(db, registry);
 *   await repos.for("invoice").create({ customerId: 1 });
 *
 * Repositories are built lazily and cached, since a Repository is
 * just a thin, stateless-except-for-config wrapper around a model
 * descriptor - reusing one instance per model avoids rebuilding it on
 * every call without changing any behavior.
 */
export declare class RepositoryFactory {
    #private;
    /**
     * @param {import('knex').Knex} db
     * @param {import('../models/registry.js').ModelRegistry} modelRegistry
     * @param {import('../fields/registry.js').FieldTypeRegistry} [fieldTypeRegistry]
     */
    constructor(db: import('knex').Knex, modelRegistry: import('../models/registry.js').ModelRegistry, fieldTypeRegistry?: import('../fields/registry.js').FieldTypeRegistry);
    /**
     * @param {string} modelName
     * @returns {Repository}
     */
    for(modelName: string): Repository;
}
