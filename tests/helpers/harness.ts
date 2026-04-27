import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { PaperlessAPI } from "../../src/api/PaperlessAPI";
import { createServer } from "../../src/server";

export interface FetchCall {
  url: string;
  init: RequestInit;
}

export interface FetchHarness {
  api: PaperlessAPI;
  client: Client;
  calls: FetchCall[];
  setNextResponse(body: unknown, init?: ResponseInit): void;
  setNextRawResponse(response: Response): void;
  cleanup(): Promise<void>;
}

export const TEST_BASE_URL = "https://paperless.test";
export const TEST_TOKEN = "test-token-secret";

export async function setupHarness(): Promise<FetchHarness> {
  const calls: FetchCall[] = [];
  const responseQueue: Array<Response> = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    const next = responseQueue.shift();
    if (!next) {
      throw new Error(`Unexpected fetch to ${url} — no response queued`);
    }
    return next;
  }) as typeof fetch;

  const api = new PaperlessAPI(TEST_BASE_URL, TEST_TOKEN);
  const server = createServer(api);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  return {
    api,
    client,
    calls,
    setNextResponse(body: unknown, init: ResponseInit = {}) {
      responseQueue.push(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
          ...init,
        })
      );
    },
    setNextRawResponse(response: Response) {
      responseQueue.push(response);
    },
    async cleanup() {
      await client.close();
      await server.close();
      globalThis.fetch = originalFetch;
    },
  };
}

export function getText(result: CallToolResult): string {
  const first = result.content[0];
  if (!first || first.type !== "text") {
    throw new Error("Expected text content in tool result");
  }
  return first.text;
}

export function parseJson(result: CallToolResult): unknown {
  return JSON.parse(getText(result));
}
