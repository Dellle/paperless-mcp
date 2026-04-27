import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DOCUMENT, EMPTY_PAGE, PATH, paginated } from "./fixtures/paperless";
import { type FetchHarness, parseJson, setupHarness } from "./helpers/harness";

describe("filter_documents tool", () => {
  let h: FetchHarness;

  beforeEach(async () => {
    h = await setupHarness();
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("hits /documents/ with no params when called empty", async () => {
    h.onGet(PATH.documents as string).reply(EMPTY_PAGE);

    await h.client.callTool({ name: "filter_documents", arguments: {} });

    expect(h.lastCall().parsedUrl.search).toBe("");
  });

  it("emits array filter params as comma-joined values", async () => {
    h.onGet(PATH.documents as string).reply(EMPTY_PAGE);

    await h.client.callTool({
      name: "filter_documents",
      arguments: {
        tags__id__all: [1, 2, 3],
        correspondent__id__in: [7],
      },
    });

    const url = h.lastCall().parsedUrl;
    expect(url.searchParams.get("tags__id__all")).toBe("1,2,3");
    expect(url.searchParams.get("correspondent__id__in")).toBe("7");
  });

  it("stringifies booleans and forwards scalars", async () => {
    h.onGet(PATH.documents as string).reply(EMPTY_PAGE);

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

    const url = h.lastCall().parsedUrl;
    expect(url.searchParams.get("is_in_inbox")).toBe("true");
    expect(url.searchParams.get("has_custom_fields")).toBe("false");
    expect(url.searchParams.get("title__icontains")).toBe("invoice");
    expect(url.searchParams.get("created__gte")).toBe("2024-01-01");
    expect(url.searchParams.get("ordering")).toBe("-created");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("page_size")).toBe("10");
  });

  it("JSON-encodes custom_field_query and forwards verbatim", async () => {
    h.onGet(PATH.documents as string).reply(EMPTY_PAGE);

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

    const raw = h.lastCall().parsedUrl.searchParams.get("custom_field_query");
    expect(JSON.parse(raw as string)).toEqual(cfq);
  });

  it("strips content/download_url/thumbnail_url from results", async () => {
    h.onGet(PATH.documents as string).reply(
      paginated([{ ...DOCUMENT, id: 9, title: "Receipt", content: "long".repeat(500) }])
    );

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
    h.onGet(PATH.documents as string).reply(EMPTY_PAGE);

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

    const raw = h.lastCall().parsedUrl.searchParams.get("custom_field_query");
    expect(JSON.parse(raw as string)).toEqual(cfq);
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
    h.onGet(PATH.customFields as string).reply(
      paginated([{ id: 1, name: "Invoice Total", data_type: "monetary", extra_data: {} }])
    );

    const result = await h.client.callTool({ name: "list_custom_fields", arguments: {} });

    h.expectCalled("GET", "/api/custom_fields/");
    const body = parseJson(result as never) as { results: Array<Record<string, unknown>> };
    expect(body.results[0]?.name).toBe("Invoice Total");
  });
});
