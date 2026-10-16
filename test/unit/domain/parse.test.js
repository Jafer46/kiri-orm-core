import { describe, it, expect } from "vitest";
import { parseDomain } from "../../../src/domain/parse.js";
import { DomainSyntaxError } from "../../../src/domain/errors.js";

describe("parseDomain", () => {
  it("parses an empty domain as a matches-everything AND with no children", () => {
    expect(parseDomain([])).toEqual({ type: "and", children: [] });
  });

  it("parses a single leaf directly (no unnecessary AND wrapper)", () => {
    expect(parseDomain([["status", "=", "done"]])).toEqual({
      type: "leaf",
      field: "status",
      op: "=",
      value: "done",
    });
  });

  it("implicitly ANDs multiple top-level leaves", () => {
    expect(
      parseDomain([
        ["status", "=", "done"],
        ["amount", ">", 100],
      ])
    ).toEqual({
      type: "and",
      children: [
        { type: "leaf", field: "status", op: "=", value: "done" },
        { type: "leaf", field: "amount", op: ">", value: 100 },
      ],
    });
  });

  it("parses explicit '&' the same as implicit AND", () => {
    expect(parseDomain(["&", ["a", "=", 1], ["b", "=", 2]])).toEqual({
      type: "and",
      children: [
        { type: "leaf", field: "a", op: "=", value: 1 },
        { type: "leaf", field: "b", op: "=", value: 2 },
      ],
    });
  });

  it("parses '|' as an OR group", () => {
    expect(parseDomain(["|", ["a", "=", 1], ["b", "=", 2]])).toEqual({
      type: "or",
      children: [
        { type: "leaf", field: "a", op: "=", value: 1 },
        { type: "leaf", field: "b", op: "=", value: 2 },
      ],
    });
  });

  it("parses '!' as a NOT wrapping a single expression", () => {
    expect(parseDomain(["!", ["a", "=", 1]])).toEqual({
      type: "not",
      children: [{ type: "leaf", field: "a", op: "=", value: 1 }],
    });
  });

  it("parses nested groups: OR of an AND and a leaf", () => {
    const domain = ["|", ["&", ["a", "=", 1], ["b", "=", 2]], ["c", "=", 3]];
    expect(parseDomain(domain)).toEqual({
      type: "or",
      children: [
        {
          type: "and",
          children: [
            { type: "leaf", field: "a", op: "=", value: 1 },
            { type: "leaf", field: "b", op: "=", value: 2 },
          ],
        },
        { type: "leaf", field: "c", op: "=", value: 3 },
      ],
    });
  });

  it("throws for a non-array domain", () => {
    expect(() => parseDomain("not-an-array")).toThrow(DomainSyntaxError);
  });

  it("throws for a leaf that isn't a 3-element array", () => {
    expect(() => parseDomain([["a", "="]])).toThrow(DomainSyntaxError);
    expect(() => parseDomain([["a"]])).toThrow(DomainSyntaxError);
  });

  it("throws for an unknown operator", () => {
    expect(() => parseDomain([["a", "~=", 1]])).toThrow(DomainSyntaxError);
  });

  it("throws when '&' doesn't have two following expressions", () => {
    expect(() => parseDomain(["&", ["a", "=", 1]])).toThrow(DomainSyntaxError);
  });

  it("throws when '!' has nothing following it", () => {
    expect(() => parseDomain(["!"])).toThrow(DomainSyntaxError);
  });

  it("throws for a leaf with a non-string field name", () => {
    expect(() => parseDomain([[123, "=", 1]])).toThrow(DomainSyntaxError);
  });
});
