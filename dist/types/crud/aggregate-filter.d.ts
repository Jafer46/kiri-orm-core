/**
 * Turns the filter into an AST (a plain-object filter becomes `[field = value]` terms).
 * @param {Record<string, unknown>|unknown[]|undefined|null} filter
 */
export declare function filterToAst(filter: Record<string, unknown> | unknown[] | undefined | null): import("../domain/parse.js").DomainNode;
/** True if a plain-object filter names one of the result's own columns (so it can't be a simple column filter). */
export declare function mentionsResultColumn(filter: any, plan: any): boolean;
/**
 * Splits a filter AST into the part for WHERE and the part for HAVING.
 *
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {import('../domain/parse.js').DomainNode} ast
 * @param {import('./aggregate-spec.js').AggregatePlan} plan
 * @returns {{ where: import('../domain/parse.js').DomainNode, having: import('../domain/parse.js').DomainNode|null }}
 */
export declare function splitFilter(model: import('../models/define-model.js').ModelDescriptor, ast: import('../domain/parse.js').DomainNode, plan: import('./aggregate-spec.js').AggregatePlan): {
    where: import('../domain/parse.js').DomainNode;
    having: import('../domain/parse.js').DomainNode | null;
};
/**
 * Compiles the HAVING half to one SQL string plus its bindings.
 *
 * @param {import('./aggregate-spec.js').AggregatePlan} plan
 * @param {import('../domain/parse.js').DomainNode} ast
 * @param {(entry: object) => { sql: string, bindings: unknown[] }} expressionFor - the aggregate's SQL expression
 * @param {import('../models/define-model.js').ModelDescriptor} model
 * @param {import('../fields/registry.js').FieldTypeRegistry} fieldTypeRegistry
 * @returns {{ sql: string, bindings: unknown[] }}
 */
export declare function compileHaving(model: import('../models/define-model.js').ModelDescriptor, plan: import('./aggregate-spec.js').AggregatePlan, ast: import('../domain/parse.js').DomainNode, expressionFor: (entry: object) => {
    sql: string;
    bindings: unknown[];
}, fieldTypeRegistry: import('../fields/registry.js').FieldTypeRegistry): {
    sql: string;
    bindings: unknown[];
};
