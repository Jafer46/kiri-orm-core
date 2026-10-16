export type ModelMetaSnapshot = {
    table_name: string;
    removed: boolean;
    /**
     * - ordered by name
     */
    fields: Array<{
        name: string;
        column: string;
        type: string;
        required: boolean;
        is_unique: boolean;
        is_indexed: boolean;
        options: unknown;
        removed: boolean;
    }>;
};
/**
 * @param {import('knex').Knex} db
 * @param {string} modelName
 * @returns {Promise<ModelMetaSnapshot|null>} null if the model has no metadata row at all
 */
export declare function snapshotModelMeta(db: import('knex').Knex, modelName: string): Promise<ModelMetaSnapshot | null>;
/**
 * Makes a model's metadata rows match `snapshot` exactly: rows are
 * created or updated to the snapshot's values, rows the snapshot
 * doesn't have are deleted, and `null` deletes the model's metadata
 * entirely (it did not exist in that state). Run it inside the same
 * transaction as the schema change it accompanies.
 *
 * @param {import('knex').Knex} db - ideally a transaction
 * @param {string} modelName
 * @param {ModelMetaSnapshot|null} snapshot
 */
export declare function restoreModelMeta(db: import('knex').Knex, modelName: string, snapshot: ModelMetaSnapshot | null): Promise<void>;
