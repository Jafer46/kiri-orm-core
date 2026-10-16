/**
 * Checks the shape of a raw definition and says what kind of layer it is.
 *
 * @param {unknown} def
 * @returns {{ kind: "primary"|"abstract"|"extension", name: string }} `name` is the model the layer belongs to
 */
export declare function classifyDefinition(def: unknown): {
    kind: "primary" | "abstract" | "extension";
    name: string;
};
/** How a layer is named in error messages and in `origins`. */
export declare function layerLabel(layer: any): string;
/** Names that must already be defined before this layer can be applied. */
export declare function requirementsOf(layer: any): any[];
/**
 * Folds a model's layers (mixins expanded, in order) into the single
 * definition defineModel() will validate. Reads everything fresh from
 * `specs` every time - nothing is cached - so a change to a mixin is
 * always seen by the models that use it.
 *
 * @param {string} name
 * @param {Map<string, { abstract: boolean, layers: Array<{ kind: string, def: object, origin?: string|null }> }>} specs
 * @param {string[]} [stack] - models currently being folded, to catch mixin cycles
 * @returns {{ table: string|undefined, primaryKey: string|undefined, fields: Record<string, object>, relations: Record<string, object>, origins: Record<string, string> }}
 */
export declare function foldModel(name: string, specs: Map<string, {
    abstract: boolean;
    layers: Array<{
        kind: string;
        def: object;
        origin?: string | null;
    }>;
}>, stack?: string[]): {
    table: string | undefined;
    primaryKey: string | undefined;
    fields: Record<string, object>;
    relations: Record<string, object>;
    origins: Record<string, string>;
};
/**
 * Every mixin used by `name`'s layers, transitively (a mixin using
 * another mixin counts too). Used to decide which mixins' hooks a
 * concrete model should pick up when it's created - see
 * `global/create-model.js`'s `createModel()`.
 *
 * @param {string} name
 * @param {Map<string, { abstract: boolean, layers: Array<{ kind: string, def: object }> }>} specs
 * @returns {string[]} deepest mixins first - a mixin's own mixins resolve
 *   before the mixin that includes them, matching how `foldModel()` folds
 *   their fields (so the same ordering intuition applies to both)
 */
export declare function collectMixinNames(name: string, specs: Map<string, {
    abstract: boolean;
    layers: Array<{
        kind: string;
        def: object;
    }>;
}>, seen?: Set<any>): string[];
/**
 * Names of every model that mixes in `name`, directly or through
 * another mixin, according to `specs`.
 *
 * @param {string} name
 * @param {Map<string, { abstract: boolean, layers: Array<{ kind: string, def: object }> }>} specs
 * @returns {string[]}
 */
export declare function dependentsOf(name: string, specs: Map<string, {
    abstract: boolean;
    layers: Array<{
        kind: string;
        def: object;
    }>;
}>): string[];
