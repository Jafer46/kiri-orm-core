const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/**
 * The name of a model's primary-key FIELD, or null if it has none.
 *
 * A model built by defineModel() carries `primaryKey` explicitly. The
 * fallback (a field literally named `id`) only serves descriptors that
 * predate declared primary keys, e.g. ones a test builds by hand.
 *
 * @param {{ primaryKey?: string|null, fields: Record<string, unknown> }} model
 * @returns {string|null}
 */
export function primaryKeyOf(model) {
  if (model.primaryKey !== undefined) return model.primaryKey;
  return has(model.fields, "id") ? "id" : null;
}

/** The primary key's column name, or null. */
export function primaryKeyColumnOf(model) {
  const key = primaryKeyOf(model);
  return key === null ? null : model.columns[key];
}

/**
 * Like primaryKeyOf(), but throws `ErrorClass` when the model has no
 * primary key. `needing` finishes the sentence "... needs a primary key".
 *
 * @param {object} model
 * @param {string} needing - what needs it, for the message
 * @param {new (message: string) => Error} ErrorClass
 * @returns {string}
 */
export function requirePrimaryKey(model, needing, ErrorClass = Error) {
  const key = primaryKeyOf(model);
  if (key === null) {
    throw new ErrorClass(
      `${needing} needs a primary key, but model "${model.name}" has none. ` +
        `Declare one with \`primaryKey: "<field>"\` on the model (or \`primaryKey: true\` on a field), ` +
        `or add a field named "id".`
    );
  }
  return key;
}

/**
 * Decides which field is the primary key while a model is being defined.
 *
 * Precedence: the model's `primaryKey` option, else the one field marked
 * `primaryKey: true`, else a field named `id`, else none.
 *
 * @param {string} modelName
 * @param {Record<string, object>} storedFields - the model's stored (non-computed) fields, raw
 * @param {unknown} declared - the model-level `primaryKey` option
 * @param {new (message: string) => Error} ErrorClass
 * @returns {string|null}
 */
export function resolvePrimaryKey(modelName, storedFields, declared, ErrorClass) {
  const flagged = Object.entries(storedFields)
    .filter(([, options]) => options && typeof options === "object" && options.primaryKey === true)
    .map(([name]) => name);

  if (flagged.length > 1) {
    throw new ErrorClass(
      `Model "${modelName}": more than one field is marked \`primaryKey: true\` (${flagged.join(", ")}). ` +
        `Composite primary keys aren't supported - pick one field.`
    );
  }

  if (declared !== undefined) {
    if (Array.isArray(declared)) {
      throw new ErrorClass(`Model "${modelName}": composite primary keys aren't supported - \`primaryKey\` must be a single field name.`);
    }
    if (typeof declared !== "string" || !declared.trim()) {
      throw new ErrorClass(`Model "${modelName}": \`primaryKey\` must be the name of one of its fields`);
    }
    if (!has(storedFields, declared)) {
      throw new ErrorClass(
        `Model "${modelName}": \`primaryKey\` is "${declared}", which is not a stored field of the model. ` +
          `Fields: ${Object.keys(storedFields).join(", ")}. (Computed fields can't be primary keys.)`
      );
    }
    if (flagged.length === 1 && flagged[0] !== declared) {
      throw new ErrorClass(
        `Model "${modelName}": \`primaryKey\` is "${declared}" but field "${flagged[0]}" is marked \`primaryKey: true\`. Use one or the other.`
      );
    }
    return declared;
  }

  if (flagged.length === 1) return flagged[0];
  return has(storedFields, "id") ? "id" : null;
}
