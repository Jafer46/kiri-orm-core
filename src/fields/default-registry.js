import { FieldTypeRegistry } from "./registry.js";
import { charType } from "./types/char.js";
import { textType } from "./types/text.js";
import { integerType } from "./types/integer.js";
import { floatType } from "./types/float.js";
import { booleanType } from "./types/boolean.js";
import { dateType } from "./types/date.js";
import { datetimeType } from "./types/datetime.js";
import { jsonType } from "./types/json.js";
import { enumType } from "./types/enum.js";
import { uuidType } from "./types/uuid.js";

/**
 * The registry used by defineField()/validateValue()/castValue() when
 * no explicit registry is passed in. Plugins can register additional
 * types onto this instance, or callers can construct their own
 * `new FieldTypeRegistry()` for isolation (e.g. in tests).
 */
export function createDefaultFieldTypeRegistry() {
  const registry = new FieldTypeRegistry();
  registry
    .register(charType)
    .register(textType)
    .register(integerType)
    .register(floatType)
    .register(booleanType)
    .register(dateType)
    .register(datetimeType)
    .register(jsonType)
    .register(enumType)
    .register(uuidType);
  return registry;
}

export const defaultFieldTypeRegistry = createDefaultFieldTypeRegistry();
