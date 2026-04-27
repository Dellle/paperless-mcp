import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PaperlessAPI } from "../src/api/PaperlessAPI";
import { EMPTY_PAGE, PATH } from "./fixtures/paperless";
import { expectMcpError, type FetchHarness, setupHarness, TEST_BASE_URL } from "./helpers/harness";

describe("API version negotiation", () => {
  let h: FetchHarness;

  beforeEach(async () => {
    h = await setupHarness();
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("downgrades subsequent requests when server reports a lower X-Api-Version", async () => {
    h.setServerApiVersion(7);
    h.onGet(PATH.tags as string).reply(EMPTY_PAGE);
    h.onGet(PATH.correspondents as string).reply(EMPTY_PAGE);

    await h.client.callTool({ name: "list_tags", arguments: {} });
    await h.client.callTool({ name: "list_correspondents", arguments: {} });

    expect(h.requestHeader("Accept", 0)).toBe("application/json; version=10");
    expect(h.requestHeader("Accept", 1)).toBe("application/json; version=7");
  });

  it("never upgrades past the configured ceiling", async () => {
    h.setServerApiVersion(20);
    h.onGet(PATH.tags as string).reply(EMPTY_PAGE);
    h.onGet(PATH.correspondents as string).reply(EMPTY_PAGE);

    await h.client.callTool({ name: "list_tags", arguments: {} });
    await h.client.callTool({ name: "list_correspondents", arguments: {} });

    expect(h.requestHeader("Accept", 1)).toBe("application/json; version=10");
  });

  it("retries once on 406 using server's reported X-Api-Version", async () => {
    h.onGet(PATH.tags as string)
      .replyRaw(
        new Response(JSON.stringify({ detail: "Not acceptable" }), {
          status: 406,
          headers: { "content-type": "application/json", "x-api-version": "5" },
        })
      )
      .replyRaw(
        new Response(JSON.stringify({ id: 1, name: "ok" }), {
          status: 200,
          headers: { "content-type": "application/json", "x-api-version": "5" },
        })
      );

    const result = await h.api.request("/tags/");

    expect(result).toEqual({ id: 1, name: "ok" });
    expect(h.calls).toHaveLength(2);
    expect(h.requestHeader("Accept", 0)).toBe("application/json; version=10");
    expect(h.requestHeader("Accept", 1)).toBe("application/json; version=5");
    expect(h.api.getApiVersion()).toBe("5");
  });

  it("respects apiVersion option as initial ceiling", async () => {
    await h.cleanup();
    h = await setupHarness();
    const api = new PaperlessAPI(TEST_BASE_URL, "tok", { apiVersion: "5" });
    h.onGet(PATH.tags as string).reply({});

    await api.request("/tags/");

    expect(h.requestHeader("Accept")).toBe("application/json; version=5");
  });

  it("throws a clear error when custom_field_query is used on too-old API version", async () => {
    h.setServerApiVersion(7);
    h.onGet(PATH.tags as string).reply(EMPTY_PAGE);

    await h.client.callTool({ name: "list_tags", arguments: {} });

    const result = await h.client.callTool({
      name: "filter_documents",
      arguments: { custom_field_query: ["foo", "exact", "bar"] },
    });

    expectMcpError(result, /custom_field_query.*requires.*version 9/i);
  });

  it("throws a clear error when list_custom_fields is used on too-old API version", async () => {
    h.setServerApiVersion(7);
    h.onGet(PATH.tags as string).reply(EMPTY_PAGE);

    await h.client.callTool({ name: "list_tags", arguments: {} });

    const result = await h.client.callTool({
      name: "list_custom_fields",
      arguments: {},
    });

    expectMcpError(result, /list_custom_fields.*requires.*version 9/i);
  });

  it("filter_documents WITHOUT custom_field_query works on older API versions", async () => {
    h.setServerApiVersion(5);
    h.onGet(PATH.tags as string).reply(EMPTY_PAGE);
    h.onGet(PATH.documents as string).reply(EMPTY_PAGE);

    await h.client.callTool({ name: "list_tags", arguments: {} });

    const result = (await h.client.callTool({
      name: "filter_documents",
      arguments: { tags__id__all: [1, 2] },
    })) as { isError?: boolean };

    expect(result.isError).toBeFalsy();
    const docCall = h.expectCalled("GET", "/api/documents/");
    expect(docCall.parsedUrl.searchParams.get("tags__id__all")).toBe("1,2");
  });
});
