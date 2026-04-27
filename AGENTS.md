# paperless-mcp

MCP (Model Context Protocol) server that exposes Paperless-NGX document management as AI-callable tools.

## Architecture

```
src/
  index.ts              # Entry point: CLI parsing, transport setup (stdio or HTTP/SSE)
  server.ts             # createServer(api) — wires PaperlessAPI to all tool domains
  api/
    PaperlessAPI.ts     # HTTP client wrapping the Paperless-NGX REST API (version 5)
  tools/
    _result.ts          # asTextResult() helper: wraps any value into MCP CallToolResult
    documents.ts        # Document CRUD, search, bulk operations, upload
    tags.ts             # Tag CRUD and bulk operations
    correspondents.ts   # Correspondent CRUD and bulk operations
    documentTypes.ts    # Document type CRUD and bulk operations
tests/
  helpers/harness.ts    # Reusable test harness: in-memory MCP client/server + fetch mock
  server.test.ts        # MCP integration tests (one block per tool domain)
```

**Adding a new tool domain**: create `src/tools/<domain>.ts` exporting `register<Domain>Tools(server: McpServer, api: PaperlessAPI)`, then call it inside `createServer()` in `src/server.ts`. Do NOT wire it directly in `src/index.ts` — `index.ts` only handles transport setup.

**Adding a new API method**: add it to `PaperlessAPI.ts` using `this.request(path, options)` — the base method injects auth headers and throws on non-2xx responses. Methods return `Promise<unknown>`; callers narrow as needed.

## Build & Run

```bash
npm start            # Run with ts-node (development)
npm run build        # Compile TypeScript → build/
npm run inspect      # Build + launch MCP Inspector (interactive tool testing)
```

## Quality Gate

Run all four locally before pushing — CI runs the same chain on every PR (`.github/workflows/ci.yml`):

```bash
npm run lint         # Biome check (lint + format)
npm run lint:fix     # Biome auto-fix
npm run typecheck    # tsc --noEmit (strict, noUncheckedIndexedAccess)
npm test             # Vitest run-once
npm run test:watch   # Vitest watch mode
npm run test:coverage  # v8 coverage report
npm run build        # Compile (final gate)
```

Build output goes to `build/` (per `tsconfig.json`); the Smithery start command references `src/index.js` (legacy — prefer `build/index.js` for production).

## Transport Modes

| Mode | Activation | Connection details |
|------|------------|-------------------|
| stdio | default | positional args: `<baseUrl> <token>` |
| HTTP/SSE | `--http` flag | env vars `PAPERLESS_URL` and `API_KEY` |

Port for HTTP mode defaults to `3000`, overridden with `--port <n>`.

## Conventions

**Tool registration**: every `register*Tools` function has the signature `(server: McpServer, api: PaperlessAPI)` and calls `server.tool(name, description, zodSchema, handler)`. Keep each domain in its own file.

**Zod schemas**: define inline inside `server.tool()`; use `.describe()` on every field — the description is surfaced to the AI as part of the tool schema.

**Handler guard**: every handler must check `if (!api) throw new Error("Please configure API connection first")` before calling `api`.

**Handler return shape (CRITICAL)**: every handler MUST return a `CallToolResult`, i.e. `{ content: [{ type: "text", text: ... }] }`. Use the `asTextResult()` helper from `src/tools/_result.ts`:

```ts
async (args) => {
  if (!api) throw new Error("Please configure API connection first");
  return asTextResult(await api.someMethod(args));
}
```

Returning raw API JSON (without `content`) breaks the MCP protocol — clients with strict validation will reject it. The `asTextResult` helper JSON-stringifies non-string values automatically.

**Paperless API versioning**: all requests include `Accept: application/json; version=<n>`, default `n=10`. Auth uses the `Token <token>` scheme. The version is a **ceiling** — `PaperlessAPI` reads `X-Api-Version` from every response and auto-downgrades subsequent requests if the server reports a lower max. On a `406 Not Acceptable` first response, it retries once using the server-reported version. Override the default with `--api-version <n>` (stdio) or `PAPERLESS_API_VERSION` env var (HTTP mode). Features that need a minimum version (`custom_field_query`, `/api/custom_fields/`) call `api.requireApiVersion(min, feature)` and emit a clear error instead of letting the server return a cryptic 400/406.

**Bulk operations**: document bulk edits use `(documents[], method, parameters)` pattern via `/api/documents/bulk_edit/`; object bulk edits (tags, correspondents, document types) use `bulkEditObjects(ids[], objectType, operation, parameters)` via `/api/bulk_edit_objects/`.

**Token safety**: `baseUrl` and `token` are constructor params of `PaperlessAPI`; never log them. The error handler in `request()` deliberately omits headers/options because they contain the auth token — see the `SECURITY:` comment there. Do not revert that.

**Strict TypeScript**: `tsconfig.json` has `strict`, `noImplicitAny`, `noUncheckedIndexedAccess`, `noImplicitOverride`. No `any`, no `@ts-ignore`. Biome enforces `noExplicitAny: error` (overridden to `off` only inside `**/*.test.ts`).

**Imports**: use `import type` for types-only imports (Biome rule `useImportType`). Use the `node:` protocol for Node built-ins (e.g. `import { Buffer } from "node:buffer"` if needed).

## Testing

Tests live in `tests/` and use Vitest. **The harness in `tests/helpers/harness.ts` is the entry point for every new test** — it sets up an in-memory MCP client/server pair backed by a real `PaperlessAPI` whose `fetch` is mocked.

### Writing a test

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type FetchHarness, parseJson, setupHarness } from "./helpers/harness";

describe("my new tool", () => {
  let h: FetchHarness;
  beforeEach(async () => { h = await setupHarness(); });
  afterEach(async () => { await h.cleanup(); });

  it("hits the right endpoint", async () => {
    h.setNextResponse({ id: 1 });                        // queue mock fetch response
    const result = await h.client.callTool({             // call through the real MCP client
      name: "my_tool",
      arguments: { foo: "bar" },
    });
    expect(h.calls[0]?.url).toBe("https://paperless.test/api/...");
    expect(parseJson(result as never)).toEqual({ id: 1 });
  });
});
```

### Harness API (`tests/helpers/harness.ts`)

- `setupHarness()` → `{ api, client, calls, setNextResponse, setNextRawResponse, cleanup }`
- `calls: FetchCall[]` — every fetch made by the API client is recorded as `{ url, init }`
- `setNextResponse(body, init?)` — queue a JSON response for the next fetch (auto-stringifies)
- `setNextRawResponse(response)` — queue a raw `Response` (use for non-JSON, error statuses, custom headers)
- `getText(result)` / `parseJson(result)` — extract the text payload from a `CallToolResult`

### What to test (and what not to)

- **DO** test: tool registration (name appears in `listTools`), URL/method/body shape of the API call, zod schema rejection of bad input, response transformations (e.g. `searchDocuments` strips `content`/`download_url`/`thumbnail_url`), error propagation.
- **DO NOT** test: the MCP SDK itself, Paperless-NGX behavior, or unit-level details of `PaperlessAPI` already covered by an integration test through the MCP client.

### Coverage

`vitest.config.ts` excludes `src/index.ts` from coverage (transport bootstrapping is covered by manual smoke testing via `npm run inspect`). All other `src/**/*.ts` is in scope.
