import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PaperlessAPI } from "../src/api/PaperlessAPI";
import { type FetchHarness, parseJson, setupHarness, TEST_TOKEN } from "./helpers/harness";

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
    h.setNextResponse({ count: 0, results: [] });
    await h.client.callTool({ name: "list_tags", arguments: {} });

    expect(h.calls).toHaveLength(1);
    const headers = h.calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Token ${TEST_TOKEN}`);
    expect(headers.Accept).toBe("application/json; version=10");
  });

  it("rejects invalid arguments via zod schema", async () => {
    await expect(
      h.client.callTool({ name: "get_document", arguments: { id: "not-a-number" } })
    ).rejects.toThrow(/Invalid arguments/);
  });
});

describe("documents tools", () => {
  let h: FetchHarness;

  beforeEach(async () => {
    h = await setupHarness();
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("get_document hits the correct endpoint", async () => {
    h.setNextResponse({ id: 42, title: "Receipt" });
    const result = await h.client.callTool({ name: "get_document", arguments: { id: 42 } });

    expect(h.calls[0]?.url).toBe("https://paperless.test/api/documents/42/");
    expect(parseJson(result as never)).toEqual({ id: 42, title: "Receipt" });
  });

  it("search_documents strips content/download_url/thumbnail_url to protect token budget", async () => {
    h.setNextResponse({
      count: 1,
      results: [
        {
          id: 1,
          title: "Invoice",
          content: "very long OCR text".repeat(1000),
          download_url: "https://paperless.test/api/documents/1/download/",
          thumbnail_url: "https://paperless.test/api/documents/1/thumb/",
          tags: [3],
        },
      ],
    });

    const result = await h.client.callTool({
      name: "search_documents",
      arguments: { query: "invoice", page: 2, page_size: 10 },
    });

    expect(h.calls[0]?.url).toBe(
      "https://paperless.test/api/documents/?query=invoice&page=2&page_size=10"
    );

    const body = parseJson(result as never) as { results: Array<Record<string, unknown>> };
    const first = body.results[0];
    expect(first?.id).toBe(1);
    expect(first?.title).toBe("Invoice");
    expect(first?.tags).toEqual([3]);
    expect(first?.content).toBeUndefined();
    expect(first?.download_url).toBeUndefined();
    expect(first?.thumbnail_url).toBeUndefined();
  });

  it("bulk_edit_documents posts the correct body shape", async () => {
    h.setNextResponse({ result: "ok" });
    await h.client.callTool({
      name: "bulk_edit_documents",
      arguments: { documents: [1, 2, 3], method: "add_tag", tag: 5 },
    });

    expect(h.calls[0]?.url).toBe("https://paperless.test/api/documents/bulk_edit/");
    expect(h.calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(h.calls[0]?.init.body as string)).toEqual({
      documents: [1, 2, 3],
      method: "add_tag",
      parameters: { tag: 5 },
    });
  });

  it("propagates HTTP errors as tool errors", async () => {
    h.setNextRawResponse(
      new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      })
    );

    const result = (await h.client.callTool({
      name: "get_document",
      arguments: { id: 999 },
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/status: 404/);
  });
});

describe("tags tools", () => {
  let h: FetchHarness;

  beforeEach(async () => {
    h = await setupHarness();
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("create_tag posts to /tags/", async () => {
    h.setNextResponse({ id: 7, name: "Invoice", color: "#ff0000" });
    const result = await h.client.callTool({
      name: "create_tag",
      arguments: { name: "Invoice", color: "#ff0000" },
    });

    expect(h.calls[0]?.url).toBe("https://paperless.test/api/tags/");
    expect(h.calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(h.calls[0]?.init.body as string)).toEqual({
      name: "Invoice",
      color: "#ff0000",
    });
    expect(parseJson(result as never)).toMatchObject({ id: 7, name: "Invoice" });
  });

  it("bulk_edit_tags routes through /bulk_edit_objects/ with object_type=tags", async () => {
    h.setNextResponse({ result: "ok" });
    await h.client.callTool({
      name: "bulk_edit_tags",
      arguments: { tag_ids: [1, 2], operation: "delete" },
    });

    expect(h.calls[0]?.url).toBe("https://paperless.test/api/bulk_edit_objects/");
    const body = JSON.parse(h.calls[0]?.init.body as string);
    expect(body).toEqual({
      objects: [1, 2],
      object_type: "tags",
      operation: "delete",
    });
  });

  it("bulk_edit_tags forwards permission parameters when set_permissions", async () => {
    h.setNextResponse({ result: "ok" });
    await h.client.callTool({
      name: "bulk_edit_tags",
      arguments: {
        tag_ids: [1],
        operation: "set_permissions",
        owner: 5,
        merge: true,
        permissions: { view: { users: [1] }, change: { users: [1] } },
      },
    });

    const body = JSON.parse(h.calls[0]?.init.body as string);
    expect(body.object_type).toBe("tags");
    expect(body.operation).toBe("set_permissions");
    expect(body.owner).toBe(5);
    expect(body.merge).toBe(true);
    expect(body.permissions).toBeDefined();
  });
});

describe("correspondents tools", () => {
  let h: FetchHarness;
  beforeEach(async () => {
    h = await setupHarness();
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it("list_correspondents calls /correspondents/", async () => {
    h.setNextResponse({ count: 0, results: [] });
    await h.client.callTool({ name: "list_correspondents", arguments: {} });
    expect(h.calls[0]?.url).toBe("https://paperless.test/api/correspondents/");
  });

  it("create_correspondent posts to /correspondents/", async () => {
    h.setNextResponse({ id: 1, name: "ACME" });
    await h.client.callTool({
      name: "create_correspondent",
      arguments: { name: "ACME", matching_algorithm: "fuzzy" },
    });
    expect(h.calls[0]?.url).toBe("https://paperless.test/api/correspondents/");
    expect(h.calls[0]?.init.method).toBe("POST");
  });

  it("bulk_edit_correspondents uses object_type=correspondents", async () => {
    h.setNextResponse({ result: "ok" });
    await h.client.callTool({
      name: "bulk_edit_correspondents",
      arguments: { correspondent_ids: [1, 2], operation: "delete" },
    });
    const body = JSON.parse(h.calls[0]?.init.body as string);
    expect(body.object_type).toBe("correspondents");
  });
});

describe("document types tools", () => {
  let h: FetchHarness;
  beforeEach(async () => {
    h = await setupHarness();
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it("list_document_types calls /document_types/", async () => {
    h.setNextResponse({ count: 0, results: [] });
    await h.client.callTool({ name: "list_document_types", arguments: {} });
    expect(h.calls[0]?.url).toBe("https://paperless.test/api/document_types/");
  });

  it("create_document_type posts to /document_types/", async () => {
    h.setNextResponse({ id: 1, name: "Invoice" });
    await h.client.callTool({
      name: "create_document_type",
      arguments: { name: "Invoice", matching_algorithm: "any" },
    });
    expect(h.calls[0]?.url).toBe("https://paperless.test/api/document_types/");
    expect(h.calls[0]?.init.method).toBe("POST");
  });

  it("bulk_edit_document_types uses object_type=document_types", async () => {
    h.setNextResponse({ result: "ok" });
    await h.client.callTool({
      name: "bulk_edit_document_types",
      arguments: { document_type_ids: [1], operation: "delete" },
    });
    const body = JSON.parse(h.calls[0]?.init.body as string);
    expect(body.object_type).toBe("document_types");
  });
});

describe("filter_documents tool", () => {
  let h: FetchHarness;
  beforeEach(async () => {
    h = await setupHarness();
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it("hits /documents/ with no params when called empty", async () => {
    h.setNextResponse({ count: 0, results: [] });
    await h.client.callTool({ name: "filter_documents", arguments: {} });
    expect(h.calls[0]?.url).toBe("https://paperless.test/api/documents/");
  });

  it("emits array filter params as comma-joined values", async () => {
    h.setNextResponse({ count: 0, results: [] });
    await h.client.callTool({
      name: "filter_documents",
      arguments: {
        tags__id__all: [1, 2, 3],
        correspondent__id__in: [7],
      },
    });
    const url = new URL(h.calls[0]?.url as string);
    expect(url.searchParams.get("tags__id__all")).toBe("1,2,3");
    expect(url.searchParams.get("correspondent__id__in")).toBe("7");
  });

  it("stringifies booleans and forwards scalars", async () => {
    h.setNextResponse({ count: 0, results: [] });
    await h.client.callTool({
      name: "filter_documents",
      arguments: {
        is_in_inbox: true,
        has_custom_fields: false,
        title__icontains: "invoice",
        created__gte: "2024-01-01",
        ordering: "-created",
        page: 2,
        page_size: 10,
      },
    });
    const url = new URL(h.calls[0]?.url as string);
    expect(url.searchParams.get("is_in_inbox")).toBe("true");
    expect(url.searchParams.get("has_custom_fields")).toBe("false");
    expect(url.searchParams.get("title__icontains")).toBe("invoice");
    expect(url.searchParams.get("created__gte")).toBe("2024-01-01");
    expect(url.searchParams.get("ordering")).toBe("-created");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("page_size")).toBe("10");
  });

  it("JSON-encodes custom_field_query and forwards verbatim", async () => {
    h.setNextResponse({ count: 0, results: [] });
    const cfq = [
      "AND",
      [
        ["Invoice Total", "gt", 100],
        ["status", "exact", "pending"],
      ],
    ];
    await h.client.callTool({
      name: "filter_documents",
      arguments: { custom_field_query: cfq },
    });
    const url = new URL(h.calls[0]?.url as string);
    expect(JSON.parse(url.searchParams.get("custom_field_query") as string)).toEqual(cfq);
  });

  it("strips content/download_url/thumbnail_url from results", async () => {
    h.setNextResponse({
      count: 1,
      results: [
        {
          id: 9,
          title: "Receipt",
          content: "long ocr".repeat(500),
          download_url: "https://x/y",
          thumbnail_url: "https://x/t",
          tags: [1],
        },
      ],
    });
    const result = await h.client.callTool({
      name: "filter_documents",
      arguments: { tags__id__all: [1] },
    });
    const body = parseJson(result as never) as { results: Array<Record<string, unknown>> };
    const first = body.results[0];
    expect(first?.content).toBeUndefined();
    expect(first?.download_url).toBeUndefined();
    expect(first?.thumbnail_url).toBeUndefined();
    expect(first?.id).toBe(9);
  });

  it("rejects malformed custom_field_query shape via zod", async () => {
    await expect(
      h.client.callTool({
        name: "filter_documents",
        arguments: { custom_field_query: { not: "an array" } },
      })
    ).rejects.toThrow(/Invalid arguments/);
  });

  it("accepts nested AND/OR/NOT trees", async () => {
    h.setNextResponse({ count: 0, results: [] });
    const cfq = [
      "OR",
      [
        ["NOT", ["archived", "exact", true]],
        [
          "AND",
          [
            ["due", "range", ["2024-01-01", "2024-12-31"]],
            ["amount", "gte", 50],
          ],
        ],
      ],
    ];
    await h.client.callTool({
      name: "filter_documents",
      arguments: { custom_field_query: cfq },
    });
    const url = new URL(h.calls[0]?.url as string);
    expect(JSON.parse(url.searchParams.get("custom_field_query") as string)).toEqual(cfq);
  });
});

describe("custom fields tool", () => {
  let h: FetchHarness;
  beforeEach(async () => {
    h = await setupHarness();
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it("list_custom_fields hits /custom_fields/", async () => {
    h.setNextResponse({
      count: 1,
      results: [{ id: 1, name: "Invoice Total", data_type: "monetary", extra_data: {} }],
    });
    const result = await h.client.callTool({ name: "list_custom_fields", arguments: {} });
    expect(h.calls[0]?.url).toBe("https://paperless.test/api/custom_fields/");
    const body = parseJson(result as never) as { results: Array<Record<string, unknown>> };
    expect(body.results[0]?.name).toBe("Invoice Total");
  });
});

describe("API version negotiation", () => {
  let h: FetchHarness;
  beforeEach(async () => {
    h = await setupHarness();
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it("downgrades subsequent requests when server reports a lower X-Api-Version", async () => {
    h.setNextResponse(
      { count: 0, results: [] },
      { headers: { "content-type": "application/json", "x-api-version": "7" } }
    );
    h.setNextResponse({ count: 0, results: [] });

    await h.client.callTool({ name: "list_tags", arguments: {} });
    await h.client.callTool({ name: "list_correspondents", arguments: {} });

    const firstHeaders = h.calls[0]?.init.headers as Record<string, string>;
    const secondHeaders = h.calls[1]?.init.headers as Record<string, string>;
    expect(firstHeaders.Accept).toBe("application/json; version=10");
    expect(secondHeaders.Accept).toBe("application/json; version=7");
  });

  it("never upgrades past the configured ceiling", async () => {
    h.setNextResponse(
      { count: 0, results: [] },
      { headers: { "content-type": "application/json", "x-api-version": "20" } }
    );
    h.setNextResponse({ count: 0, results: [] });

    await h.client.callTool({ name: "list_tags", arguments: {} });
    await h.client.callTool({ name: "list_correspondents", arguments: {} });

    const secondHeaders = h.calls[1]?.init.headers as Record<string, string>;
    expect(secondHeaders.Accept).toBe("application/json; version=10");
  });

  it("retries once on 406 using server's reported X-Api-Version", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init: RequestInit = {}) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({ url, init });
      if (calls.length === 1) {
        return new Response(JSON.stringify({ detail: "Not acceptable" }), {
          status: 406,
          headers: { "content-type": "application/json", "x-api-version": "5" },
        });
      }
      return new Response(JSON.stringify({ id: 1, name: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json", "x-api-version": "5" },
      });
    }) as typeof fetch;

    try {
      const api = new PaperlessAPI("https://paperless.test", "tok");
      const result = await api.request("/tags/");
      expect(result).toEqual({ id: 1, name: "ok" });
      expect(calls).toHaveLength(2);
      expect((calls[0]?.init.headers as Record<string, string>).Accept).toBe(
        "application/json; version=10"
      );
      expect((calls[1]?.init.headers as Record<string, string>).Accept).toBe(
        "application/json; version=5"
      );
      expect(api.getApiVersion()).toBe("5");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("respects apiVersion option as initial ceiling", async () => {
    const originalFetch = globalThis.fetch;
    let captured: Record<string, string> = {};
    globalThis.fetch = (async (_input: Parameters<typeof fetch>[0], init: RequestInit = {}) => {
      captured = init.headers as Record<string, string>;
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const api = new PaperlessAPI("https://paperless.test", "tok", { apiVersion: "5" });
      await api.request("/tags/");
      expect(captured.Accept).toBe("application/json; version=5");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("throws a clear error when custom_field_query is used on too-old API version", async () => {
    h.setNextResponse(
      { count: 0, results: [] },
      { headers: { "content-type": "application/json", "x-api-version": "7" } }
    );
    await h.client.callTool({ name: "list_tags", arguments: {} });

    const result = (await h.client.callTool({
      name: "filter_documents",
      arguments: { custom_field_query: ["foo", "exact", "bar"] },
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/custom_field_query.*requires.*version 9/i);
  });

  it("throws a clear error when list_custom_fields is used on too-old API version", async () => {
    h.setNextResponse(
      { count: 0, results: [] },
      { headers: { "content-type": "application/json", "x-api-version": "7" } }
    );
    await h.client.callTool({ name: "list_tags", arguments: {} });

    const result = (await h.client.callTool({
      name: "list_custom_fields",
      arguments: {},
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/list_custom_fields.*requires.*version 9/i);
  });

  it("filter_documents WITHOUT custom_field_query works on older API versions", async () => {
    h.setNextResponse(
      { count: 0, results: [] },
      { headers: { "content-type": "application/json", "x-api-version": "5" } }
    );
    await h.client.callTool({ name: "list_tags", arguments: {} });

    h.setNextResponse({ count: 0, results: [] });
    const result = (await h.client.callTool({
      name: "filter_documents",
      arguments: { tags__id__all: [1, 2] },
    })) as { isError?: boolean };

    expect(result.isError).toBeFalsy();
    const url = new URL(h.calls[1]?.url as string);
    expect(url.searchParams.get("tags__id__all")).toBe("1,2");
  });
});
