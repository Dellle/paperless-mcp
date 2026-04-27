import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PaperlessAPI } from "../api/PaperlessAPI";
import { asTextResult } from "./_result";

export function registerCustomFieldTools(server: McpServer, api: PaperlessAPI) {
  server.tool(
    "list_custom_fields",
    [
      "List all custom fields defined in this Paperless-NGX instance.",
      "",
      "CALL THIS FIRST before constructing a `custom_field_query` for filter_documents — the response tells you each field's `id`, `name`, `data_type`, and (for select fields) the available options in `extra_data`.",
      "",
      "Returned fields per entry:",
      "  - id:         numeric ID (use as fieldRef in custom_field_query atoms)",
      "  - name:       human name (also usable as fieldRef in atoms)",
      "  - data_type:  one of: string, url, date, boolean, integer, float, monetary, documentlink, select, longtext",
      "                — determines which operators are valid (see filter_documents description).",
      "  - extra_data: type-specific config — e.g. for 'select', the list of option labels/ids; for 'monetary', currency.",
    ].join("\n"),
    {},
    async () => {
      if (!api) throw new Error("Please configure API connection first");
      return asTextResult(await api.getCustomFields());
    }
  );
}
