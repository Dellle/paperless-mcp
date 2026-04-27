import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { PaperlessAPI } from "./api/PaperlessAPI";
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
    const app = express();
    app.use(express.json());

    const sseTransports: Record<string, SSEServerTransport> = {};

    app.post("/mcp", async (req, res) => {
      try {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });
        res.on("close", () => {
          transport.close();
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        console.error("Error handling MCP request:", error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: {
              code: -32603,
              message: "Internal server error",
            },
            id: null,
          });
        }
      }
    });

    app.get("/mcp", async (_req, res) => {
      res.writeHead(405).end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Method not allowed.",
          },
          id: null,
        })
      );
    });

    app.delete("/mcp", async (_req, res) => {
      res.writeHead(405).end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Method not allowed.",
          },
          id: null,
        })
      );
    });

    app.get("/sse", async (_req, res) => {
      console.log("SSE request received");
      try {
        const transport = new SSEServerTransport("/messages", res);
        sseTransports[transport.sessionId] = transport;
        res.on("close", () => {
          delete sseTransports[transport.sessionId];
          transport.close();
        });
        await server.connect(transport);
      } catch (error) {
        console.error("Error handling SSE request:", error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: {
              code: -32603,
              message: "Internal server error",
            },
            id: null,
          });
        }
      }
    });

    app.post("/messages", async (req, res) => {
      const sessionId = req.query.sessionId as string;
      const transport = sseTransports[sessionId];
      if (transport) {
        await transport.handlePostMessage(req, res, req.body);
      } else {
        res.status(400).send("No transport found for sessionId");
      }
    });

    app.listen(port, () => {
      console.log(`MCP Stateless Streamable HTTP Server listening on port ${port}`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

main().catch((e) => console.error(e.message));
