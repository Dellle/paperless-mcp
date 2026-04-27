import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OK, PATH, TAG } from "./fixtures/paperless";
import { type FetchHarness, parseJson, setupHarness } from "./helpers/harness";

describe("tags tools", () => {
  let h: FetchHarness;

  beforeEach(async () => {
    h = await setupHarness();
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("create_tag posts to /tags/", async () => {
    h.onPost(PATH.tags as string).reply({ ...TAG, id: 7, name: "Invoice", color: "#ff0000" });

    const result = await h.client.callTool({
      name: "create_tag",
      arguments: { name: "Invoice", color: "#ff0000" },
    });

    h.expectCalled("POST", "/api/tags/");
    expect(h.requestBody()).toEqual({ name: "Invoice", color: "#ff0000" });
    expect(parseJson(result as never)).toMatchObject({ id: 7, name: "Invoice" });
  });

  it("bulk_edit_tags routes through /bulk_edit_objects/ with object_type=tags", async () => {
    h.onPost(PATH.bulkEditObjects as string).reply(OK);

    await h.client.callTool({
      name: "bulk_edit_tags",
      arguments: { tag_ids: [1, 2], operation: "delete" },
    });

    h.expectCalled("POST", "/api/bulk_edit_objects/");
    expect(h.requestBody()).toEqual({
      objects: [1, 2],
      object_type: "tags",
      operation: "delete",
    });
  });

  it("bulk_edit_tags forwards permission parameters when set_permissions", async () => {
    h.onPost(PATH.bulkEditObjects as string).reply(OK);

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

    const body = h.requestBody() as Record<string, unknown>;
    expect(body.object_type).toBe("tags");
    expect(body.operation).toBe("set_permissions");
    expect(body.owner).toBe(5);
    expect(body.merge).toBe(true);
    expect(body.permissions).toBeDefined();
  });
});
