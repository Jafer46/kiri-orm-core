import { FieldTypeRegistry } from "./registry.js";
/**
 * The registry used by defineField()/validateValue()/castValue() when
 * no explicit registry is passed in. Plugins can register additional
 * types onto this instance, or callers can construct their own
 * `new FieldTypeRegistry()` for isolation (e.g. in tests).
 */
export declare function createDefaultFieldTypeRegistry(): FieldTypeRegistry;
export declare const defaultFieldTypeRegistry: FieldTypeRegistry;
