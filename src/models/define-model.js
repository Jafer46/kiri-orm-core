import { defineField } from "../fields/define-field.js";
import { defineComputedField, isComputedField } from "../fields/define-computed-field.js";
import { applyAutoIdDefault } from "../fields/auto-id.js";
import { defaultFieldTypeRegistry } from "../fields/default-registry.js";
import { defaultNamingStrategy } from "./naming.js";
import { InvalidModelDefinitionError } from "./errors.js";
import { defineRelation } from "../relations/define-relation.js";
import { resolvePrimaryKey } from "./primary-key.js";

/**
 * @typedef {Object} ModelDescriptor
 * @property {string} name
 * @property {string} tableName
 * @property {Record<string, import('../fields/define-field.js').FieldDescriptor>} fields
 * @property {string|null} primaryKey - name of the primary-key field: the model's `primaryKey` option, else the
 *   one field marked `primaryKey: true`, else a field named `id`, else null. That field's descriptor carries
 *   `primary: true`. Single-field keys only.
 * @property {Record<string, string>} columns - fieldName -> resolved column name
 * @property {Record<string, import('../relations/define-relation.js').RelationDescriptor>} relations
 * @property {Record<string, import('../fields/define-computed-field.js').ComputedFieldDescriptor>} computed -
 *   virtual fields: calculated on read, never stored. Deliberately separate from `fields`, which is
 *   everything that has a column; everything that persists data iterates `fields` and so can't see these.
 */

/**
 * Finds a dependency cycle among computed fields, if there is one.
 * @returns {string[]|null} the cycle as [a, b, ..., a]
 */
function findComputedCycle(computed) {
  const state = {}; // undefined = unvisited, 1 = on the current path, 2 = done
  const path = [];
  const visit = (name) => {
    state[name] = 1;
    path.push(name);
    for (const dep of computed[name].depends) {
      if (!(dep in computed)) continue;
      if (state[dep] === 1) return [...path.slice(path.indexOf(dep)), dep];
      if (state[dep] === undefined) {
        const cycle = visit(dep);
        if (cycle) return cycle;
      }
    }
    path.pop();
    state[name] = 2;
    return null;
  };
  for (const name of Object.keys(computed)) {
    if (state[name] === undefined) {
      const cycle = visit(name);
      if (cycle) return cycle;
    }
  }
  return null;
}

/**
 * Defines a model: a named collection of fields (from Phase 1), plus
 * the resolved table/column names a naming strategy produces from
 * them. This is still purely in-memory - no DB access happens here.
 * Schema sync (Phase 3) and the DB-persisted metamodel (Phase 4) both
 * build on top of the descriptor this returns.
 *
 * Field entries may be either raw field options (`{ type: "char" }`)
 * or an already-built descriptor from defineField() - both are run
 * through defineField() here so validation always happens at model
 * definition time, not deferred to first use.
 *
 * @param {Object} options
 * @param {string} options.name - model name, e.g. "invoice"
 * @param {string} [options.table] - explicit table name; defaults to
 *   namingStrategy.modelToTable(name) if omitted
 * @param {string} [options.primaryKey] - the primary-key field; defaults to the field marked
 *   `primaryKey: true`, else a field named `id`. An integer or uuid key is assigned automatically
 *   (`auto: false` on the field opts out).
 * @param {Record<string, object>} options.fields
 * @param {import('./naming.js').NamingStrategy} [namingStrategy]
 * @param {import('../fields/registry.js').FieldTypeRegistry} [fieldTypeRegistry]
 * @returns {Readonly<ModelDescriptor>}
 */
export function defineModel(
  options,
  namingStrategy = defaultNamingStrategy,
  fieldTypeRegistry = defaultFieldTypeRegistry
) {
  if (!options || typeof options !== "object") {
    throw new InvalidModelDefinitionError("Model definition must be an object");
  }
  if (typeof options.name !== "string" || !options.name.trim()) {
    throw new InvalidModelDefinitionError("Model definition requires a non-empty `name`");
  }
  if (
    !options.fields ||
    typeof options.fields !== "object" ||
    Array.isArray(options.fields) ||
    Object.keys(options.fields).length === 0
  ) {
    throw new InvalidModelDefinitionError(
      `Model "${options.name}" requires a non-empty \`fields\` object`
    );
  }
  if (options.table !== undefined && (typeof options.table !== "string" || !options.table.trim())) {
    throw new InvalidModelDefinitionError(
      `Model "${options.name}" \`table\` must be a non-empty string when provided`
    );
  }

  const fields = {};
  const columns = {};
  const columnOwners = new Map(); // columnName -> fieldName, for collision detection
  const computedInput = {};
  const storedInput = {};
  for (const [fieldName, fieldOptions] of Object.entries(options.fields)) {
    (isComputedField(fieldOptions) ? computedInput : storedInput)[fieldName] = fieldOptions;
  }
  if (Object.keys(storedInput).length === 0) {
    throw new InvalidModelDefinitionError(
      `Model "${options.name}" needs at least one stored field: computed fields have no column, so a model of only computed fields has nothing to persist`
    );
  }

  const primaryKey = resolvePrimaryKey(options.name, storedInput, options.primaryKey, InvalidModelDefinitionError);

  for (const [fieldName, fieldOptions] of Object.entries(storedInput)) {
    let field;
    try {
      field = defineField(fieldOptions, fieldTypeRegistry);
      if (fieldName === primaryKey) {
        if (field.type === "json" || field.type === "boolean") {
          throw new Error(`a "${field.type}" field can't be a primary key`);
        }
        field = Object.freeze({ ...field, primary: true });
      } else if (fieldName === "id") {
        // An `id` field that ISN'T the primary key must not be mistaken for it later.
        field = Object.freeze({ ...field, primary: false });
      }
      field = applyAutoIdDefault(fieldName, field);
    } catch (err) {
      throw new InvalidModelDefinitionError(
        `Model "${options.name}", field "${fieldName}": ${err.message}`
      );
    }
    fields[fieldName] = field;

    const columnName = fieldOptions.column ?? namingStrategy.fieldToColumn(fieldName);
    if (columnOwners.has(columnName)) {
      throw new InvalidModelDefinitionError(
        `Model "${options.name}": fields "${columnOwners.get(columnName)}" and "${fieldName}" ` +
          `both resolve to column name "${columnName}". Set an explicit \`column\` option on one of them.`
      );
    }
    columnOwners.set(columnName, fieldName);
    columns[fieldName] = columnName;
  }

  const computed = {};
  for (const [fieldName, fieldOptions] of Object.entries(computedInput)) {
    try {
      computed[fieldName] = defineComputedField(fieldOptions, fieldTypeRegistry);
    } catch (err) {
      throw new InvalidModelDefinitionError(
        `Model "${options.name}", computed field "${fieldName}": ${err.message}`
      );
    }
  }
  for (const [fieldName, field] of Object.entries(computed)) {
    for (const dep of field.depends) {
      if (!(dep in fields) && !(dep in computed)) {
        throw new InvalidModelDefinitionError(
          `Model "${options.name}", computed field "${fieldName}" depends on "${dep}", which is not a field of this model. ` +
            `Known fields: ${[...Object.keys(fields), ...Object.keys(computed)].join(", ")}`
        );
      }
    }
  }
  const cycle = findComputedCycle(computed);
  if (cycle) {
    throw new InvalidModelDefinitionError(
      `Model "${options.name}": computed fields depend on each other in a cycle (${cycle.join(" -> ")})`
    );
  }

  const relations = {};
  if (options.relations !== undefined) {
    if (typeof options.relations !== "object" || Array.isArray(options.relations)) {
      throw new InvalidModelDefinitionError(
        `Model "${options.name}" \`relations\` must be an object when provided`
      );
    }
    for (const [relationName, relationOptions] of Object.entries(options.relations)) {
      if (relationName in fields || relationName in computed) {
        throw new InvalidModelDefinitionError(
          `Model "${options.name}": relation "${relationName}" has the same name as a field. ` +
            `Eager-loaded relation results are attached under the relation's name, so it would ` +
            `silently overwrite the field's value. Rename one of them.`
        );
      }
      try {
        relations[relationName] = defineRelation(relationOptions);
      } catch (err) {
        throw new InvalidModelDefinitionError(
          `Model "${options.name}", relation "${relationName}": ${err.message}`
        );
      }
    }
  }

  const tableName = options.table ?? namingStrategy.modelToTable(options.name);

  return Object.freeze({
    name: options.name,
    tableName,
    primaryKey,
    fields: Object.freeze(fields),
    columns: Object.freeze(columns),
    relations: Object.freeze(relations),
    computed: Object.freeze(computed),
  });
}
