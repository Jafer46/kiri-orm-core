export declare const DOMAIN_OPERATORS: string[];
export type LeafNode = {
    type: "leaf";
    field: string;
    op: string;
    value: unknown;
};
export type GroupNode = {
    type: "and" | "or";
    children: DomainNode[];
};
export type NotNode = {
    type: "not";
    children: [DomainNode];
};
export type DomainNode = LeafNode | GroupNode | NotNode;
/**
 * Parses a full domain array into an AST. Top-level list items are
 * implicitly AND-ed together (matching the roadmap's example
 * `[["state", "=", "done"], ["amount", ">", 100]]`), with explicit
 * `'&'`/`'|'`/`'!'` available for anything implicit-AND can't express
 * - most importantly OR and NOT. Nested groups can be written either
 * flat (Odoo-style prefix notation) or wrapped in their own array for
 * readability - see parseOperand() for exactly how that's
 * disambiguated. An empty domain `[]` matches everything.
 *
 * @param {unknown[]} domain
 * @returns {DomainNode}
 */
export declare function parseDomain(domain: unknown[]): DomainNode;
