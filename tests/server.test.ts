import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type FetchHarness, setupHarness, TEST_TOKEN } from "./helpers/harness";

describe("MCP server registration", () => {
  let h: FetchHarness;

  beforeEach(async () => {
    h = await setupHarness();
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("exposes all expected tools", async () => {
    const { tools } = await h.client.listTools();
    const names = tools.map((t) => t.name).sort();

    expect(names).toEqual(
      [
        "bulk_edit_correspondents",
        "bulk_edit_document_types",
        "bulk_edit_documents",
        "bulk_edit_tags",
        "create_correspondent",
        "create_document_type",
        "create_tag",
        "delete_tag",
        "download_document",
        "filter_documents",
        "get_document",
        "list_correspondents",
        "list_custom_fields",
        "list_document_types",
        "list_tags",
        "post_document",
        "search_documents",
        "update_tag",
      ].sort()
    );
  });

  it("attaches version-10 Accept header and Token auth", async () => {
    h.onGet("/api/tags/").reply({ count: 0, results: [] });
    await h.client.callTool({ name: "list_tags", arguments: {} });

    expect(h.requestHeader("Authorization")).toBe(`Token ${TEST_TOKEN}`);
    expect(h.requestHeader("Accept")).toBe("application/json; version=10");
  });

  it("rejects invalid arguments via zod schema", async () => {
    await expect(
      h.client.callTool({ name: "get_document", arguments: { id: "not-a-number" } })
    ).rejects.toThrow(/Invalid arguments/);
  });
});
