import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function asTextResult(value: unknown): CallToolResult {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return { content: [{ type: "text", text }] };
}
