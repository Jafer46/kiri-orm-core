/**
 * Compiles a domain array into a function suitable for
 * `queryBuilder.where(compileDomain(model, domain))`. Field names are
 * validated against the model's registered fields at compile time
 * (before any query runs), and each leaf's value is cast through the
 * field's type the same way Repository's plain-object filters are
 * (Phase 5) - so `["id", "=", "1"]` and `{ id: "1" }` behave
 * identically.
 *
 * A field name containing a `.` (e.g. `"tags.name"`) traverses a
 * relation instead of naming a plain column - see
 * compileRelationLeaf() for exactly how that compiles. This requires
 * `modelRegistry` to resolve the relation's target model; omit it and
 * a plain (non-relation) domain still works exactly as before.
 *
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {unknown[]} domain
 * @param {import('../fields/registry.js').FieldTypeRegistry} [fieldTypeRegistry]
 * @param {import('../models/registry.js').ModelRegistry} [modelRegistry]
 * @returns {(qb: import('knex').Knex.QueryBuilder) => void}
 */
export declare function compileDomain(model: import('../models/define-model.js').ModelDescriptor, domain: unknown[], fieldTypeRegistry?: import('../fields/registry.js').FieldTypeRegistry, modelRegistry?: import('../models/registry.js').ModelRegistry): (qb: import('knex').Knex.QueryBuilder) => void;
/**
 * Like compileDomain(), for an AST that has already been parsed (see parseDomain()).
 * Aggregate queries need this: they parse once, split the tree into WHERE and HAVING
 * halves, then compile the WHERE half.
 *
 * @param {import('./parse.js').DomainNode} ast
 */
export declare function compileParsedDomain(model: any, ast: import('./parse.js').DomainNode, fieldTypeRegistry?: import("../fields/registry.js").FieldTypeRegistry, modelRegistry?: undefined): (qb: import('knex').Knex.QueryBuilder) => void;
