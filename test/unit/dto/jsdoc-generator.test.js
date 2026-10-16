import { describe, it, expect } from "vitest";
import { defineModel } from "../../../src/models/define-model.js";
import { jsonSchemaToJSDoc, generateJSDocForModel } from "../../../src/dto/jsdoc-generator.js";
import { generateCreateSchema } from "../../../src/dto/schema-generator.js";

const postModel = defineModel({
  name: "post",
  fields: {
    id: { type: "integer", required: true },
    title: { type: "char", required: true },
    status: { type: "enum", values: ["draft", "published"], default: "draft" },
    viewCount: { type: "integer" },
    publishedAt: { type: "datetime" },
  },
});

describe("jsonSchemaToJSDoc - golden file", () => {
  it("renders a required property without brackets and an optional one with them", () => {
    const schema = generateCreateSchema(postModel);
    const output = jsonSchemaToJSDoc("CreatePost", schema);
    expect(output).toBe(
      [
        "/**",
        " * @typedef {Object} CreatePost",
        " * @property {string} title",
        ' * @property {"draft"|"published"} [status]',
        " * @property {number} [viewCount]",
        " * @property {Date} [publishedAt]",
        " */",
      ].join("\n")
    );
  });
});

describe("generateJSDocForModel - golden file", () => {
  it("produces all three typedef blocks, in Create/Update/Read order, separated by a blank line", () => {
    const output = generateJSDocForModel(postModel);
    const blocks = output.split("\n\n");
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toContain("@typedef {Object} CreatePost");
    expect(blocks[1]).toContain("@typedef {Object} UpdatePost");
    expect(blocks[2]).toContain("@typedef {Object} ReadPost");
    expect(blocks[2]).toContain("@property {number} id"); // read includes id, required
  });
});
