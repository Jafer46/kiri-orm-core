import { ColumnBuilderRegistry } from "./column-builder-registry.js";
/**
 * Each builder only creates the column itself (type-specific shape).
 * Common modifiers - nullable/unique/index/default - are applied
 * uniformly afterward in build-column.js, so builders here don't
 * repeat that logic per type.
 */
export declare function createDefaultColumnBuilderRegistry(): ColumnBuilderRegistry;
export declare const defaultColumnBuilderRegistry: ColumnBuilderRegistry;
