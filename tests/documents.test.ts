import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DOCUMENT, EMPTY_PAGE, OK, PATH, paginated } from "./fixtures/paperless";
import { expectMcpError, type FetchHarness, parseJson, setupHarness } from "./helpers/harness";

describe("documents tools", () => {
  let h: FetchHarness;

  beforeEach(async () => {
    h = await setupHarness();
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("get_document hits the correct endpoint", async () => {
    h.onGet(PATH.documentById as RegExp).reply({ ...DOCUMENT, id: 42, title: "Receipt" });

    const result = await h.client.callTool({ name: "get_document", arguments: { id: 42 } });

    h.expectCalled("GET", "/api/documents/42/");
    expect((parseJson(result as never) as { id: number; title: string }).title).toBe("Receipt");
  });

  it("search_documents strips content/download_url/thumbnail_url to protect token budget", async () => {
    h.onGet(PATH.documents as string).reply(
      paginated([{ ...DOCUMENT, id: 1, title: "Invoice", content: "x".repeat(10_000) }])
    );

    const result = await h.client.callTool({
      name: "search_documents",
      arguments: { query: "invoice", page: 2, page_size: 10 },
    });

    const call = h.expectCalled("GET", "/api/documents/");
    expect(call.parsedUrl.searchParams.get("query")).toBe("invoice");
    expect(call.parsedUrl.searchParams.get("page")).toBe("2");
    expect(call.parsedUrl.searchParams.get("page_size")).toBe("10");

    const body = parseJson(result as never) as { results: Array<Record<string, unknown>> };
    const first = body.results[0];
    expect(first?.id).toBe(1);
    expect(first?.title).toBe("Invoice");
    expect(first?.content).toBeUndefined();
    expect(first?.download_url).toBeUndefined();
    expect(first?.thumbnail_url).toBeUndefined();
  });

  it("bulk_edit_documents posts the correct body shape", async () => {
    h.onPost(PATH.documentsBulkEdit as string).reply(OK);

    await h.client.callTool({
      name: "bulk_edit_documents",
      arguments: { documents: [1, 2, 3], method: "add_tag", tag: 5 },
    });

    h.expectCalled("POST", "/api/documents/bulk_edit/");
    expect(h.requestBody()).toEqual({
      documents: [1, 2, 3],
      method: "add_tag",
      parameters: { tag: 5 },
    });
  });

  it("propagates HTTP errors as tool errors", async () => {
    h.onGet(PATH.documentById as RegExp).replyError(404, { detail: "Not found" });

    const result = await h.client.callTool({
      name: "get_document",
      arguments: { id: 999 },
    });

    expectMcpError(result, /status: 404/);
  });

  it("propagates network errors as tool errors", async () => {
    h.setNextNetworkError("ECONNREFUSED");

    const result = await h.client.callTool({
      name: "get_document",
      arguments: { id: 1 },
    });

    expectMcpError(result, /ECONNREFUSED/);
  });

  it("default reply lets a route serve unlimited matching requests", async () => {
    h.onGet(PATH.documents as string).replyDefault(EMPTY_PAGE);

    await h.client.callTool({ name: "search_documents", arguments: { query: "a" } });
    await h.client.callTool({ name: "search_documents", arguments: { query: "b" } });
    await h.client.callTool({ name: "search_documents", arguments: { query: "c" } });

    expect(h.callsTo(PATH.documents as string)).toHaveLength(3);
  });
});
