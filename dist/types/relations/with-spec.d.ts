export type WithNode = {
    select: string[] | null;
    with: Map<string, WithNode>;
    where: unknown;
    orderBy: unknown;
    limit: number | undefined;
    offset: number | undefined;
    whereFn: Function | null;
    order: Array<{
        field: string;
        direction: "asc" | "desc";
    }>;
};
/**
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {import('../models/registry.js').ModelRegistry} modelRegistry
 * @param {unknown} input - any accepted shape of `with`
 * @param {import('../fields/registry.js').FieldTypeRegistry} [fieldTypeRegistry] - for compiling `where`
 * @returns {Map<string, WithNode>} empty when nothing is to be loaded
 * @throws {RelationError} unknown relation or option, malformed entry
 * @throws {import('../crud/errors.js').ValidationError} a `select` naming a field that doesn't exist
 */
export declare function normalizeWith(model: import('../models/define-model.js').ModelDescriptor, modelRegistry: import('../models/registry.js').ModelRegistry, input: unknown, fieldTypeRegistry?: import('../fields/registry.js').FieldTypeRegistry): Map<string, WithNode>;
/**
 * The fields of `model` that must be read for the relations in `tree` to be matched to it:
 * a belongsTo reads the foreign key, everything else reads the local key.
 *
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {import('../models/registry.js').ModelRegistry} modelRegistry
 * @param {Map<string, WithNode>} tree
 * @returns {string[]}
 */
export declare function parentKeysNeeded(model: import('../models/define-model.js').ModelDescriptor, modelRegistry: import('../models/registry.js').ModelRegistry, tree: Map<string, WithNode>): string[];
