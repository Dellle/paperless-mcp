import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Express } from "express";

const METHOD_NOT_ALLOWED = {
  jsonrpc: "2.0" as const,
  error: { code: -32000, message: "Method not allowed." },
  id: null,
};

const INTERNAL_ERROR = {
  jsonrpc: "2.0" as const,
  error: { code: -32603, message: "Internal server error" },
  id: null,
};

export function createHttpApp(server: McpServer): Express {
  const app = express();
  app.use(express.json());

  const sseTransports: Record<string, SSEServerTransport> = {};

  app.post("/mcp", async (req, res) => {
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        transport.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) res.status(500).json(INTERNAL_ERROR);
    }
  });

  app.get("/mcp", (_req, res) => {
    res.writeHead(405).end(JSON.stringify(METHOD_NOT_ALLOWED));
  });

  app.delete("/mcp", (_req, res) => {
    res.writeHead(405).end(JSON.stringify(METHOD_NOT_ALLOWED));
  });

  app.get("/sse", async (_req, res) => {
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
      if (!res.headersSent) res.status(500).json(INTERNAL_ERROR);
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

  return app;
}
