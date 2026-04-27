#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PaperlessAPI } from "./api/PaperlessAPI";
import { createHttpApp } from "./http";
import { createServer } from "./server";

const args = process.argv.slice(2);
const useHttp = args.includes("--http");
let port = 3000;
const portIndex = args.indexOf("--port");
if (portIndex !== -1 && args[portIndex + 1]) {
  const parsed = parseInt(args[portIndex + 1] as string, 10);
  if (!Number.isNaN(parsed)) port = parsed;
}

let apiVersion: string | undefined;
const versionIndex = args.indexOf("--api-version");
if (versionIndex !== -1 && args[versionIndex + 1]) {
  apiVersion = args[versionIndex + 1];
} else if (process.env.PAPERLESS_API_VERSION) {
  apiVersion = process.env.PAPERLESS_API_VERSION;
}

async function main() {
  let baseUrl: string | undefined;
  let token: string | undefined;

  if (useHttp) {
    baseUrl = process.env.PAPERLESS_URL;
    token = process.env.API_KEY;
    if (!baseUrl || !token) {
      console.error(
        "When using --http, PAPERLESS_URL and API_KEY environment variables must be set."
      );
      process.exit(1);
    }
  } else {
    baseUrl = args[0];
    token = args[1];
    if (!baseUrl || !token) {
      console.error(
        "Usage: paperless-mcp <baseUrl> <token> [--http] [--port <port>] [--api-version <n>]"
      );
      console.error(
        "Example: paperless-mcp http://localhost:8000 your-api-token --http --port 3000"
      );
      console.error(
        "When using --http, PAPERLESS_URL and API_KEY environment variables must be set."
      );
      console.error(
        "API version defaults to 10 (current Paperless-NGX). Override with --api-version 9 (or older) for older instances, or via PAPERLESS_API_VERSION env var. The client auto-downgrades to the server's reported max via X-Api-Version."
      );
      process.exit(1);
    }
  }

  const api = new PaperlessAPI(baseUrl, token, { apiVersion });
  const server = createServer(api);

  if (useHttp) {
    const app = createHttpApp(server);
    app.listen(port, () => {
      console.log(`MCP Stateless Streamable HTTP Server listening on port ${port}`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

main().catch((e) => console.error(e.message));
