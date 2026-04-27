import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CORRESPONDENT, EMPTY_PAGE, OK, PATH } from "./fixtures/paperless";
import { type FetchHarness, setupHarness } from "./helpers/harness";

describe("correspondents tools", () => {
  let h: FetchHarness;

  beforeEach(async () => {
    h = await setupHarness();
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("list_correspondents calls /correspondents/", async () => {
    h.onGet(PATH.correspondents as string).reply(EMPTY_PAGE);

    await h.client.callTool({ name: "list_correspondents", arguments: {} });

    h.expectCalled("GET", "/api/correspondents/");
  });

  it("create_correspondent posts to /correspondents/", async () => {
    h.onPost(PATH.correspondents as string).reply({ ...CORRESPONDENT, id: 1, name: "ACME" });

    await h.client.callTool({
      name: "create_correspondent",
      arguments: { name: "ACME", matching_algorithm: "fuzzy" },
    });

    h.expectCalled("POST", "/api/correspondents/");
  });

  it("bulk_edit_correspondents uses object_type=correspondents", async () => {
    h.onPost(PATH.bulkEditObjects as string).reply(OK);

    await h.client.callTool({
      name: "bulk_edit_correspondents",
      arguments: { correspondent_ids: [1, 2], operation: "delete" },
    });

    expect((h.requestBody() as Record<string, unknown>).object_type).toBe("correspondents");
  });
});
