import { DomainSyntaxError } from "./errors.js";

export const DOMAIN_OPERATORS = ["=", "!=", ">", ">=", "<", "<=", "in", "not in", "like", "ilike"];

const PREFIX_TO_NODE_TYPE = { "&": "and", "|": "or" };

/**
 * @typedef {{ type: "leaf", field: string, op: string, value: unknown }} LeafNode
 * @typedef {{ type: "and"|"or", children: DomainNode[] }} GroupNode
 * @typedef {{ type: "not", children: [DomainNode] }} NotNode
 * @typedef {LeafNode|GroupNode|NotNode} DomainNode
 */

function looksLikeLeaf(value) {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    typeof value[0] === "string" &&
    DOMAIN_OPERATORS.includes(value[1])
  );
}

/**
 * Consumes exactly one domain operand from the front of `list` and
 * returns it along with whatever's left. An operand is one of:
 *
 * - a prefix token ('&' or '|') starting a FLAT continuation that
 *   consumes the next two operands from `list` itself - Odoo's actual
 *   syntax, e.g. `["&", ["a","=",1], ["b","=",2], ...moreAfterThat]`.
 * - a prefix token ('!') consuming the next one operand the same way.
 * - a leaf triple `[field, op, value]`, consumed directly.
 * - any OTHER array is treated as a fully self-contained nested
 *   sub-domain and parsed recursively via parseDomain() - this is
 *   what makes `["|", ["&", ["a","=",1], ["b","=",2]], ["c","=",3]]`
 *   work: the wrapped `["&", ...]` doesn't look like a leaf triple
 *   (it's 3 elements but the first isn't a field-name-shaped string
 *   paired with a real operator), so it's recognized as its own
 *   self-contained group rather than misread as a malformed leaf.
 *   This dual support means both the terse flat style and the more
 *   visually nested style JS developers naturally reach for both work.
 *
 * @param {unknown[]} list
 * @returns {{ node: DomainNode, rest: unknown[] }}
 */
function parseOperand(list) {
  if (list.length === 0) {
    throw new DomainSyntaxError("Expected another domain expression but the list ended");
  }
  const [head, ...rest] = list;

  if (head === "&" || head === "|") {
    const { node: left, rest: rest1 } = parseOperand(rest);
    const { node: right, rest: rest2 } = parseOperand(rest1);
    return { node: { type: PREFIX_TO_NODE_TYPE[head], children: [left, right] }, rest: rest2 };
  }

  if (head === "!") {
    const { node: child, rest: rest1 } = parseOperand(rest);
    return { node: { type: "not", children: [child] }, rest: rest1 };
  }

  if (Array.isArray(head)) {
    if (looksLikeLeaf(head)) {
      const [field, op, value] = head;
      return { node: { type: "leaf", field, op, value }, rest };
    }
    // Not leaf-shaped -> a self-contained nested sub-domain.
    return { node: parseDomain(head), rest };
  }

  throw new DomainSyntaxError(
    `Expected a leaf condition [field, operator, value], a nested domain array, or one of '&' '|' '!', got ${JSON.stringify(head)}`
  );
}

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
export function parseDomain(domain) {
  if (!Array.isArray(domain)) {
    throw new DomainSyntaxError("A domain must be an array");
  }
  if (domain.length === 0) {
    return { type: "and", children: [] };
  }

  const nodes = [];
  let remaining = domain;
  while (remaining.length > 0) {
    const { node, rest } = parseOperand(remaining);
    nodes.push(node);
    remaining = rest;
  }

  return nodes.length === 1 ? nodes[0] : { type: "and", children: nodes };
}
