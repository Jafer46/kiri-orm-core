import { castValue } from "../fields/cast-value.js";
import { defaultFieldTypeRegistry } from "../fields/default-registry.js";
import { parseDomain } from "./parse.js";
import { DomainValidationError } from "./errors.js";
import { resolveLocalKey } from "../relations/keys.js";
import { primaryKeyOf } from "../models/primary-key.js";

const OPERATOR_HANDLERS = {
  "=": (qb, column, value) => (value === null ? qb.whereNull(column) : qb.where(column, "=", value)),
  "!=": (qb, column, value) => (value === null ? qb.whereNotNull(column) : qb.where(column, "!=", value)),
  ">": (qb, column, value) => qb.where(column, ">", value),
  ">=": (qb, column, value) => qb.where(column, ">=", value),
  "<": (qb, column, value) => qb.where(column, "<", value),
  "<=": (qb, column, value) => qb.where(column, "<=", value),
  in: (qb, column, value) => qb.whereIn(column, value),
  "not in": (qb, column, value) => qb.whereNotIn(column, value),
  like: (qb, column, value) => qb.where(column, "like", value),
  // Portable case-insensitive match across sqlite and postgres (postgres
  // has native ILIKE, but LOWER()/LOWER() works identically on both,
  // so one code path covers both dialects rather than branching).
  ilike: (qb, column, value) => qb.whereRaw("LOWER(??) LIKE LOWER(?)", [column, value]),
};

function castLeafValue(field, fieldName, op, value, fieldTypeRegistry) {
  if (op === "in" || op === "not in") {
    if (!Array.isArray(value)) {
      throw new DomainValidationError(`Operator "${op}" on field "${fieldName}" requires an array value`);
    }
    return value.map((v) => (v === null ? null : castValue(field, v, fieldTypeRegistry)));
  }
  if (op === "like" || op === "ilike") {
    return String(value); // a pattern, not a field value - don't run it through type coercion
  }
  if (value === null) return null;
  return castValue(field, value, fieldTypeRegistry);
}

/**
 * Compiles a leaf on a COMPUTED field by asking the field's `search`
 * function to translate it - Odoo's compute-and-search pattern. Given
 * the operator and the (already type-cast) value, `search` returns a
 * domain over other fields; that domain is compiled in place of the
 * leaf, as one self-contained node, so it combines correctly with
 * whatever '&' / '|' / '!' surrounds it.
 *
 * The returned domain may itself name computed fields (compiled the
 * same way) or traverse relations. `expanding` is the chain of
 * computed fields currently being expanded, so a `search` that
 * (directly or through another) asks about its own field is reported
 * as the cycle it is instead of recursing forever.
 */
function compileComputedLeaf(node, computed, model, fieldTypeRegistry, modelRegistry, expanding) {
  if (typeof computed.search !== "function") {
    throw new DomainValidationError(
      `Field "${node.field}" on model "${model.name}" is computed and can't be used in a domain: ` +
        `give it a \`search(operator, value)\` function that returns a domain over stored fields.`
    );
  }
  const key = `${model.name}.${node.field}`;
  if (expanding.includes(key)) {
    throw new DomainValidationError(`Circular search on computed fields: ${[...expanding, key].join(" -> ")}`);
  }

  const value = castLeafValue(computed, node.field, node.op, node.value, fieldTypeRegistry);
  const domain = computed.search(node.op, value);
  if (!Array.isArray(domain)) {
    throw new DomainValidationError(
      `search() of computed field "${node.field}" on model "${model.name}" must return a domain array ` +
        `(e.g. [["firstName", "=", value]]), got ${domain === null ? "null" : typeof domain}`
    );
  }
  return compileNode(parseDomain(domain), model, fieldTypeRegistry, modelRegistry, [...expanding, key]);
}

/**
 * Compiles a leaf whose field is a plain column name on `model` (the
 * common case - no dot in `node.field`), or a computed field, which is
 * expanded via its `search`.
 */
function compilePlainLeaf(node, model, fieldTypeRegistry, modelRegistry, expanding) {
  const field = model.fields[node.field];
  if (!field) {
    const computed = model.computed?.[node.field];
    if (computed) return compileComputedLeaf(node, computed, model, fieldTypeRegistry, modelRegistry, expanding);
    if (model.relations?.[node.field]) {
      throw new DomainValidationError(
        `"${node.field}" is a relation on model "${model.name}", not a field - domains can't filter on a ` +
          `relation directly. Name a field on the related model instead, e.g. "${node.field}.id" or ` +
          `"${node.field}.name" (whatever field on the related model you want to match against).`
      );
    }
    throw new DomainValidationError(
      `Unknown field "${node.field}" in domain for model "${model.name}". ` +
        `Known fields: ${[...Object.keys(model.fields), ...Object.keys(model.computed ?? {})].join(", ") || "(none)"}. ` +
        `Known relations: ${Object.keys(model.relations ?? {}).join(", ") || "(none)"}`
    );
  }
  const column = model.columns[node.field];
  const value = castLeafValue(field, node.field, node.op, node.value, fieldTypeRegistry);
  const handler = OPERATOR_HANDLERS[node.op];
  return (qb) => handler(qb, column, value);
}

/**
 * Compiles a leaf whose field traverses a relation, e.g.
 * `"tags.name"` on a `product` model with a `tags` `belongsToMany`
 * relation. Reduces to a subquery regardless of relation type: the
 * outer row is matched by `outerColumn IN (SELECT ... FROM related
 * WHERE <condition>)`, where the inner condition is compiled by
 * recursing into compileNode() against the RELATED model with
 * whatever's left of the path (`restPath`) as its field - which is
 * itself just another leaf, possibly still dotted, handled by the
 * exact same dot-detection this function is called from. That
 * recursion is what makes arbitrary depth
 * (`"items.product.tags.name"`) work without any special-casing per
 * level - each level just asks "does this contain a dot", the same
 * question, against a narrower model each time.
 *
 * `belongsToMany` needs two nested subqueries (pivot, then related)
 * since there's no direct foreign key linking the two tables.
 *
 * @param {import('./parse.js').LeafNode} node
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {import('../fields/registry.js').FieldTypeRegistry} fieldTypeRegistry
 * @param {import('../models/registry.js').ModelRegistry} modelRegistry
 */
function compileRelationLeaf(node, model, fieldTypeRegistry, modelRegistry, expanding) {
  const [relationName, ...restParts] = node.field.split(".");
  const relation = model.relations?.[relationName];

  if (!relation) {
    throw new DomainValidationError(
      `Unknown field or relation "${relationName}" in domain for model "${model.name}" ` +
        `(from "${node.field}"). Known fields: ${Object.keys(model.fields).join(", ") || "(none)"}. ` +
        `Known relations: ${Object.keys(model.relations ?? {}).join(", ") || "(none)"}`
    );
  }
  if (!modelRegistry) {
    throw new DomainValidationError(
      `Domain field "${node.field}" traverses relation "${relationName}", which requires a modelRegistry ` +
        `to resolve. Repository/UnitOfWork instances built via RepositoryFactory, UnitOfWork, or the client ` +
        `facade (createClient) supply this automatically; a bare \`new Repository(db, model)\` does not.`
    );
  }

  const restPath = restParts.join(".");
  if (!restPath) {
    throw new DomainValidationError(
      `Domain field "${node.field}" names a relation but no field on the related model - ` +
        `use e.g. "${relationName}.someField" to filter on a field of the related model`
    );
  }

  const relatedModel = modelRegistry.getModel(relation.model);
  const innerLeaf = { type: "leaf", field: restPath, op: node.op, value: node.value };
  // Compiled EAGERLY, not deferred inside a closure - this is what
  // makes validation (unknown field, unknown relation, missing
  // modelRegistry) fire immediately when compileDomain() is called,
  // at any nesting depth, rather than silently waiting until Knex
  // actually builds the query. A real bug caught by a test written
  // specifically to check this: an earlier version wrapped this in
  // `(qb) => compileNode(...)(qb)`, which deferred the recursive
  // (and therefore validating) call until Knex invoked it - so
  // `["customer.typoField", "=", "x"]` compiled without error and
  // only failed once actually attached to a query via `.where()`.
  const innerCondition = compileNode(innerLeaf, relatedModel, fieldTypeRegistry, modelRegistry, expanding);

  if (relation.type === "belongsTo") {
    const outerColumn = model.columns[relation.foreignKey];
    const relatedColumn = relatedModel.columns[resolveLocalKey(relation, model, relatedModel)];
    return (qb) => {
      qb.whereIn(outerColumn, (subQb) => {
        subQb.select(relatedColumn).from(relatedModel.tableName).where(innerCondition);
      });
    };
  }

  if (relation.type === "hasOne" || relation.type === "hasMany") {
    const outerColumn = model.columns[resolveLocalKey(relation, model, relatedModel)];
    const relatedColumn = relatedModel.columns[relation.foreignKey];
    return (qb) => {
      qb.whereIn(outerColumn, (subQb) => {
        subQb.select(relatedColumn).from(relatedModel.tableName).where(innerCondition);
      });
    };
  }

  // belongsToMany - two nested subqueries: pivot, then related.
  const outerColumn = model.columns[resolveLocalKey(relation, model, relatedModel)];
  const relatedKey = primaryKeyOf(relatedModel);
  if (relatedKey === null) {
    throw new DomainValidationError(`Cannot filter through belongsToMany "${node.field.split(".")[0]}": related model "${relatedModel.name}" has no primary key`);
  }
  return (qb) => {
    qb.whereIn(outerColumn, (pivotQb) => {
      pivotQb.select(relation.foreignKey).from(relation.through).whereIn(relation.otherKey, (relatedQb) => {
        relatedQb.select(relatedModel.columns[relatedKey]).from(relatedModel.tableName).where(innerCondition);
      });
    });
  };
}

/**
 * @param {import('./parse.js').DomainNode} node
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {import('../fields/registry.js').FieldTypeRegistry} fieldTypeRegistry
 * @param {import('../models/registry.js').ModelRegistry} [modelRegistry] - only required if the domain traverses a relation
 * @returns {(qb: import('knex').Knex.QueryBuilder) => void}
 */
function compileNode(node, model, fieldTypeRegistry, modelRegistry, expanding = []) {
  if (node.type === "leaf") {
    return node.field.includes(".")
      ? compileRelationLeaf(node, model, fieldTypeRegistry, modelRegistry, expanding)
      : compilePlainLeaf(node, model, fieldTypeRegistry, modelRegistry, expanding);
  }

  if (node.type === "and") {
    if (node.children.length === 0) return (qb) => qb; // empty domain matches everything
    const compiled = node.children.map((child) => compileNode(child, model, fieldTypeRegistry, modelRegistry, expanding));
    return (qb) => {
      qb.where((inner) => {
        for (const fn of compiled) inner.andWhere(fn);
      });
    };
  }

  if (node.type === "or") {
    const compiled = node.children.map((child) => compileNode(child, model, fieldTypeRegistry, modelRegistry, expanding));
    return (qb) => {
      qb.where((inner) => {
        compiled.forEach((fn, i) => (i === 0 ? inner.where(fn) : inner.orWhere(fn)));
      });
    };
  }

  // node.type === "not"
  const compiledChild = compileNode(node.children[0], model, fieldTypeRegistry, modelRegistry, expanding);
  return (qb) => qb.whereNot(compiledChild);
}

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
export function compileDomain(model, domain, fieldTypeRegistry = defaultFieldTypeRegistry, modelRegistry = undefined) {
  const ast = parseDomain(domain);
  return compileNode(ast, model, fieldTypeRegistry, modelRegistry);
}

/**
 * Like compileDomain(), for an AST that has already been parsed (see parseDomain()).
 * Aggregate queries need this: they parse once, split the tree into WHERE and HAVING
 * halves, then compile the WHERE half.
 *
 * @param {import('./parse.js').DomainNode} ast
 */
export function compileParsedDomain(model, ast, fieldTypeRegistry = defaultFieldTypeRegistry, modelRegistry = undefined) {
  return compileNode(ast, model, fieldTypeRegistry, modelRegistry);
}
