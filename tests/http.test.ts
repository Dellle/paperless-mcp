import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaperlessAPI } from "../src/api/PaperlessAPI";
import { createHttpApp } from "../src/http";
import { createServer } from "../src/server";

interface RunningApp {
  baseUrl: string;
  close: () => Promise<void>;
}

async function startApp(): Promise<RunningApp> {
  const api = new PaperlessAPI("https://paperless.test", "tok");
  const server = createServer(api);
  const app = createHttpApp(server);
  return new Promise((resolve, reject) => {
    const listener = app.listen(0, () => {
      const addr = listener.address() as AddressInfo | null;
      if (!addr) {
        reject(new Error("Listener has no address"));
        return;
      }
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((r) => listener.close(() => r())),
      });
    });
    listener.on("error", reject);
  });
}

describe("HTTP transport smoke test", () => {
  let app: RunningApp;
  let originalFetch: typeof fetch;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    app = await startApp();
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await app.close();
  });

  it("rejects GET /mcp with 405 Method Not Allowed", async () => {
    const res = await fetch(`${app.baseUrl}/mcp`);

    expect(res.status).toBe(405);
    const body = await res.json();
    expect(body).toMatchObject({ error: { code: -32000 } });
  });

  it("rejects DELETE /mcp with 405 Method Not Allowed", async () => {
    const res = await fetch(`${app.baseUrl}/mcp`, { method: "DELETE" });

    expect(res.status).toBe(405);
  });

  it("handles POST /mcp tools/list end-to-end", async () => {
    const res = await fetch(`${app.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "smoke-test", version: "1.0.0" },
        },
      }),
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("paperless-ngx");
  });

  it("forwards a tool call through to the (mocked) Paperless API", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((async (
      input: Parameters<typeof fetch>[0],
      init: RequestInit = {}
    ) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.startsWith("http://127.0.0.1")) {
        return originalFetch(input, init);
      }
      return new Response(JSON.stringify({ count: 0, results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch);

    try {
      const initRes = await fetch(`${app.baseUrl}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "smoke", version: "1.0.0" },
          },
        }),
      });
      expect(initRes.status).toBe(200);

      const paperlessCall = fetchSpy.mock.calls.find(([u]) =>
        String(u).startsWith("https://paperless.test")
      );
      expect(paperlessCall ?? null).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
