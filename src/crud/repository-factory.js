import { Repository } from "./repository.js";
import { defaultFieldTypeRegistry } from "../fields/default-registry.js";

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
export class RepositoryFactory {
  #db;
  #modelRegistry;
  #fieldTypeRegistry;
  #cache = new Map();

  /**
   * @param {import('knex').Knex} db
   * @param {import('../models/registry.js').ModelRegistry} modelRegistry
   * @param {import('../fields/registry.js').FieldTypeRegistry} [fieldTypeRegistry]
   */
  constructor(db, modelRegistry, fieldTypeRegistry = defaultFieldTypeRegistry) {
    this.#db = db;
    this.#modelRegistry = modelRegistry;
    this.#fieldTypeRegistry = fieldTypeRegistry;
  }

  /**
   * @param {string} modelName
   * @returns {Repository}
   */
  for(modelName) {
    const model = this.#modelRegistry.getModel(modelName); // throws UnknownModelError if missing
    // The registry replaces a model's descriptor when another package extends it, so a
    // cached repository is only reusable while it still holds the current one.
    const cached = this.#cache.get(modelName);
    if (cached?.model !== model) {
      this.#cache.set(modelName, new Repository(this.#db, model, this.#fieldTypeRegistry, this.#modelRegistry));
    }
    return this.#cache.get(modelName);
  }
}
