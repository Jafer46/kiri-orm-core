/**
 * Table names starting with this prefix are reserved for internal
 * metadata tables and cannot be used by user-defined models (enforced
 * in ModelRegistry#register). Exported from here rather than defined
 * inline in the registry so the meta module stays the single source
 * of truth for what it owns.
 */
export const META_TABLE_PREFIX = "_meta_";

export const META_MODELS_TABLE = "_meta_models";
export const META_FIELDS_TABLE = "_meta_fields";
