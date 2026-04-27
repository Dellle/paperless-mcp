import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DOCUMENT_TYPE, EMPTY_PAGE, OK, PATH } from "./fixtures/paperless";
import { type FetchHarness, setupHarness } from "./helpers/harness";

describe("document types tools", () => {
  let h: FetchHarness;

  beforeEach(async () => {
    h = await setupHarness();
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("list_document_types calls /document_types/", async () => {
    h.onGet(PATH.documentTypes as string).reply(EMPTY_PAGE);

    await h.client.callTool({ name: "list_document_types", arguments: {} });

    h.expectCalled("GET", "/api/document_types/");
  });

  it("create_document_type posts to /document_types/", async () => {
    h.onPost(PATH.documentTypes as string).reply({ ...DOCUMENT_TYPE, id: 1, name: "Invoice" });

    await h.client.callTool({
      name: "create_document_type",
      arguments: { name: "Invoice", matching_algorithm: "any" },
    });

    h.expectCalled("POST", "/api/document_types/");
  });

  it("bulk_edit_document_types uses object_type=document_types", async () => {
    h.onPost(PATH.bulkEditObjects as string).reply(OK);

    await h.client.callTool({
      name: "bulk_edit_document_types",
      arguments: { document_type_ids: [1], operation: "delete" },
    });

    expect((h.requestBody() as Record<string, unknown>).object_type).toBe("document_types");
  });
});
