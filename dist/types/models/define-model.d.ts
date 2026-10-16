export type ModelDescriptor = {
    name: string;
    tableName: string;
    fields: Record<string, import('../fields/define-field.js').FieldDescriptor>;
    /**
     * - name of the primary-key field: the model's `primaryKey` option, else the
     * one field marked `primaryKey: true`, else a field named `id`, else null. That field's descriptor carries
     * `primary: true`. Single-field keys only.
     */
    primaryKey: string | null;
    /**
     * - fieldName -> resolved column name
     */
    columns: Record<string, string>;
    relations: Record<string, import('../relations/define-relation.js').RelationDescriptor>;
    /**
     * -
     * virtual fields: calculated on read, never stored. Deliberately separate from `fields`, which is
     * everything that has a column; everything that persists data iterates `fields` and so can't see these.
     */
    computed: Record<string, import('../fields/define-computed-field.js').ComputedFieldDescriptor>;
};
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
export declare function defineModel(options: {
    name: string;
    table?: string;
    primaryKey?: string;
    fields: Record<string, object>;
}, namingStrategy?: import('./naming.js').NamingStrategy, fieldTypeRegistry?: import('../fields/registry.js').FieldTypeRegistry): Readonly<ModelDescriptor>;
