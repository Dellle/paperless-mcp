import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { expect, vi } from "vitest";
import { PaperlessAPI } from "../../src/api/PaperlessAPI";
import { createServer } from "../../src/server";

/**
 * Test harness for the Paperless MCP server.
 *
 * Goals (designed for agentic editing):
 *  - Order-independent: route mocks by HTTP method + URL path, not by call order.
 *  - Helpful assertions: `lastCall()`, `requestBody()`, `requestHeader()`, `expectCalled()`.
 *  - Crash-safe: uses `vi.spyOn` so Vitest auto-restores `globalThis.fetch`.
 *  - Cheap to write: realistic defaults via fixtures + one-liner error helpers.
 *
 * Backward compatibility: the legacy FIFO queue (`setNextResponse` /
 * `setNextRawResponse`) still works as a fallback when no route matches. Prefer
 * the routing API for new tests.
 */

export interface FetchCall {
  url: string;
  init: RequestInit;
  /** Parsed URL for convenient access to pathname / searchParams. */
  parsedUrl: URL;
  /** HTTP method, uppercased; defaults to "GET". */
  method: string;
}

/** Path matcher: exact string match against `URL.pathname`, or a RegExp tested against `pathname`. */
export type PathMatcher = string | RegExp;

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface RouteReply {
  body: unknown;
  init: ResponseInit;
  raw?: Response;
}

interface Route {
  method: HttpMethod;
  matcher: PathMatcher;
  /** FIFO queue of replies. When empty and `defaultReply` is set, that is used; otherwise route is exhausted. */
  replies: RouteReply[];
  /** Optional default reply used when the queued replies are exhausted. */
  defaultReply?: RouteReply;
}

export interface RouteHandle {
  /** Queue another JSON reply for this route. */
  reply(body: unknown, init?: ResponseInit): RouteHandle;
  /** Queue a raw `Response` for this route. */
  replyRaw(response: Response): RouteHandle;
  /** Queue an HTTP error for this route. */
  replyError(status: number, body?: unknown): RouteHandle;
  /** Set a default reply that is used after the queued replies are exhausted. */
  replyDefault(body: unknown, init?: ResponseInit): RouteHandle;
}

export interface FetchHarness {
  api: PaperlessAPI;
  client: Client;
  /** Every fetch call recorded, in order. */
  calls: FetchCall[];

  // -------- Routing API (preferred) --------
  onGet(matcher: PathMatcher): RouteHandle;
  onPost(matcher: PathMatcher): RouteHandle;
  onPut(matcher: PathMatcher): RouteHandle;
  onPatch(matcher: PathMatcher): RouteHandle;
  onDelete(matcher: PathMatcher): RouteHandle;
  on(method: HttpMethod, matcher: PathMatcher): RouteHandle;

  /**
   * Set the `x-api-version` header that the mock server will report on every
   * JSON response (both via the routing API and the legacy FIFO queue). Use
   * this to exercise the `PaperlessAPI` auto-downgrade path.
   */
  setServerApiVersion(version: string | number | null): void;

  // -------- Legacy FIFO API (still works, used as fallback) --------
  setNextResponse(body: unknown, init?: ResponseInit): void;
  setNextRawResponse(response: Response): void;
  setNextError(status: number, body?: unknown): void;
  /** Queue a network-level failure (rejected fetch). */
  setNextNetworkError(message?: string): void;

  // -------- Assertion helpers --------
  /** Last recorded fetch call. Throws if none. */
  lastCall(): FetchCall;
  /** All recorded calls whose pathname matches. */
  callsTo(matcher: PathMatcher): FetchCall[];
  /** Parse the JSON body of the Nth call (defaults to last). Throws if body is not JSON. */
  requestBody(n?: number): unknown;
  /** Read a header from the Nth call (defaults to last), case-insensitive. */
  requestHeader(name: string, n?: number): string | undefined;
  /** Assert that a request matching method+path was made. Returns the matching call. */
  expectCalled(method: HttpMethod, matcher: PathMatcher): FetchCall;

  cleanup(): Promise<void>;
}

export const TEST_BASE_URL = "https://paperless.test";
export const TEST_TOKEN = "test-token-secret";

function pathMatches(matcher: PathMatcher, pathname: string): boolean {
  if (typeof matcher === "string") return matcher === pathname;
  return matcher.test(pathname);
}

function describeMatcher(matcher: PathMatcher): string {
  return typeof matcher === "string" ? matcher : matcher.toString();
}

function buildJsonResponse(
  body: unknown,
  init: ResponseInit,
  serverApiVersion: string | null
): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  if (serverApiVersion !== null && !headers.has("x-api-version")) {
    headers.set("x-api-version", serverApiVersion);
  }
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, { status: 200, ...init, headers });
}

export async function setupHarness(): Promise<FetchHarness> {
  const calls: FetchCall[] = [];
  const routes: Route[] = [];
  const fifoQueue: Array<
    { kind: "response"; response: Response } | { kind: "error"; error: Error }
  > = [];
  let serverApiVersion: string | null = null;

  // Use vi.spyOn so Vitest auto-restores fetch on test failure or hot-reload.
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((async (
    input: Parameters<typeof fetch>[0],
    init: RequestInit = {}
  ) => {
    const urlStr = typeof input === "string" ? input : input.toString();
    const parsedUrl = new URL(urlStr);
    const method = (init.method ?? "GET").toUpperCase();
    calls.push({ url: urlStr, init, parsedUrl, method });

    // 1. Try to match a route.
    const route = routes.find(
      (r) => r.method === method && pathMatches(r.matcher, parsedUrl.pathname)
    );
    if (route) {
      const reply = route.replies.shift() ?? route.defaultReply;
      if (!reply) {
        throw new Error(
          `Route ${method} ${describeMatcher(route.matcher)} matched ${urlStr} but has no replies queued (and no default). Call .reply() / .replyDefault() before triggering the request.`
        );
      }
      if (reply.raw) return reply.raw;
      return buildJsonResponse(reply.body, reply.init, serverApiVersion);
    }

    // 2. Fall back to FIFO queue (legacy API).
    const next = fifoQueue.shift();
    if (!next) {
      throw new Error(
        `Unexpected fetch to ${method} ${urlStr} — no route matched and FIFO queue is empty. Use h.onGet(...) / h.onPost(...) to register a route.`
      );
    }
    if (next.kind === "error") throw next.error;
    // Inject server API version into raw responses too, but only if not already set.
    if (serverApiVersion !== null && !next.response.headers.has("x-api-version")) {
      const headers = new Headers(next.response.headers);
      headers.set("x-api-version", serverApiVersion);
      return new Response(next.response.body, {
        status: next.response.status,
        statusText: next.response.statusText,
        headers,
      });
    }
    return next.response;
  }) as typeof fetch);

  const api = new PaperlessAPI(TEST_BASE_URL, TEST_TOKEN);
  const server = createServer(api);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  function makeRouteHandle(route: Route): RouteHandle {
    const handle: RouteHandle = {
      reply(body: unknown, init: ResponseInit = {}) {
        route.replies.push({ body, init });
        return handle;
      },
      replyRaw(response: Response) {
        route.replies.push({ body: undefined, init: {}, raw: response });
        return handle;
      },
      replyError(status: number, body: unknown = { detail: `HTTP ${status}` }) {
        route.replies.push({ body, init: { status } });
        return handle;
      },
      replyDefault(body: unknown, init: ResponseInit = {}) {
        route.defaultReply = { body, init };
        return handle;
      },
    };
    return handle;
  }

  function on(method: HttpMethod, matcher: PathMatcher): RouteHandle {
    const route: Route = { method, matcher, replies: [] };
    routes.push(route);
    return makeRouteHandle(route);
  }

  function getCall(n?: number): FetchCall {
    if (calls.length === 0) throw new Error("No fetch calls recorded yet.");
    const idx = n ?? calls.length - 1;
    const call = calls[idx];
    if (!call) throw new Error(`No fetch call at index ${idx} (have ${calls.length}).`);
    return call;
  }

  return {
    api,
    client,
    calls,

    onGet: (m) => on("GET", m),
    onPost: (m) => on("POST", m),
    onPut: (m) => on("PUT", m),
    onPatch: (m) => on("PATCH", m),
    onDelete: (m) => on("DELETE", m),
    on,

    setServerApiVersion(version) {
      serverApiVersion = version === null ? null : String(version);
    },

    setNextResponse(body: unknown, init: ResponseInit = {}) {
      fifoQueue.push({
        kind: "response",
        response: buildJsonResponse(body, init, serverApiVersion),
      });
    },
    setNextRawResponse(response: Response) {
      fifoQueue.push({ kind: "response", response });
    },
    setNextError(status: number, body: unknown = { detail: `HTTP ${status}` }) {
      fifoQueue.push({
        kind: "response",
        response: buildJsonResponse(body, { status }, serverApiVersion),
      });
    },
    setNextNetworkError(message = "Network error") {
      fifoQueue.push({ kind: "error", error: new Error(message) });
    },

    lastCall: () => getCall(),
    callsTo(matcher) {
      return calls.filter((c) => pathMatches(matcher, c.parsedUrl.pathname));
    },
    requestBody(n) {
      const call = getCall(n);
      const body = call.init.body;
      if (body === undefined || body === null) {
        throw new Error(`Call ${n ?? "last"} has no body.`);
      }
      if (typeof body !== "string") {
        throw new Error(
          `Call ${n ?? "last"} body is not a string (got ${typeof body}); cannot JSON-parse. Use call.init.body directly.`
        );
      }
      return JSON.parse(body);
    },
    requestHeader(name, n) {
      const call = getCall(n);
      const headers = call.init.headers;
      if (!headers) return undefined;
      const lower = name.toLowerCase();
      if (headers instanceof Headers) {
        const v = headers.get(name);
        return v === null ? undefined : v;
      }
      if (Array.isArray(headers)) {
        for (const entry of headers) {
          const k = entry[0];
          const v = entry[1];
          if (k && k.toLowerCase() === lower) return v;
        }
        return undefined;
      }
      // Plain object: case-insensitive lookup.
      for (const [k, v] of Object.entries(headers as Record<string, string>)) {
        if (k.toLowerCase() === lower) return v;
      }
      return undefined;
    },
    expectCalled(method, matcher) {
      const found = calls.find(
        (c) => c.method === method && pathMatches(matcher, c.parsedUrl.pathname)
      );
      if (!found) {
        const seen = calls.map((c) => `${c.method} ${c.parsedUrl.pathname}`).join(", ") || "(none)";
        expect.fail(
          `Expected ${method} ${describeMatcher(matcher)} to have been called. Calls so far: ${seen}`
        );
      }
      return found;
    },

    async cleanup() {
      await client.close();
      await server.close();
      fetchSpy.mockRestore();
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

/**
 * Assert a `CallToolResult` represents a tool error and (optionally) that the
 * error text matches `pattern`. Returns the error text for further assertions.
 */
export function expectMcpError(
  result: CallToolResult | unknown,
  pattern?: RegExp | string
): string {
  const r = result as { isError?: boolean; content?: Array<{ type: string; text: string }> };
  if (!r.isError) {
    expect.fail(`Expected tool result to be an error, but isError was ${r.isError}.`);
  }
  const text = r.content?.[0]?.text ?? "";
  if (pattern) {
    if (typeof pattern === "string") expect(text).toContain(pattern);
    else expect(text).toMatch(pattern);
  }
  return text;
}
