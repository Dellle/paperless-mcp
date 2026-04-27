import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BulkEditMethod, PaperlessAPI } from "../api/PaperlessAPI";
import { asTextResult } from "./_result";

export function registerDocumentTools(server: McpServer, api: PaperlessAPI) {
  server.tool(
    "bulk_edit_documents",
    "Perform bulk operations on multiple documents simultaneously: set correspondent/type/tags, delete, reprocess, merge, split, rotate, or manage permissions. Efficient for managing large document collections.",
    {
      documents: z
        .array(z.number())
        .describe(
          "Array of document IDs to perform bulk operations on. Get document IDs from search_documents first."
        ),
      method: z
        .enum([
          "set_correspondent",
          "set_document_type",
          "set_storage_path",
          "add_tag",
          "remove_tag",
          "modify_tags",
          "delete",
          "reprocess",
          "set_permissions",
          "merge",
          "split",
          "rotate",
          "delete_pages",
        ])
        .describe(
          "The bulk operation to perform: set_correspondent (assign sender/receiver), set_document_type (categorize documents), set_storage_path (organize file location), add_tag/remove_tag/modify_tags (manage labels), delete (permanently remove), reprocess (re-run OCR/indexing), set_permissions (control access), merge (combine documents), split (separate into multiple), rotate (adjust orientation), delete_pages (remove specific pages)"
        ),
      correspondent: z
        .number()
        .optional()
        .describe(
          "ID of correspondent to assign when method is 'set_correspondent'. Use list_correspondents to get valid IDs."
        ),
      document_type: z
        .number()
        .optional()
        .describe(
          "ID of document type to assign when method is 'set_document_type'. Use list_document_types to get valid IDs."
        ),
      storage_path: z
        .number()
        .optional()
        .describe(
          "ID of storage path to assign when method is 'set_storage_path'. Storage paths organize documents in folder hierarchies."
        ),
      tag: z
        .number()
        .optional()
        .describe(
          "Single tag ID to add or remove when method is 'add_tag' or 'remove_tag'. Use list_tags to get valid IDs."
        ),
      add_tags: z
        .array(z.number())
        .optional()
        .describe(
          "Array of tag IDs to add when method is 'modify_tags'. Use list_tags to get valid IDs."
        ),
      remove_tags: z
        .array(z.number())
        .optional()
        .describe(
          "Array of tag IDs to remove when method is 'modify_tags'. Use list_tags to get valid IDs."
        ),
      permissions: z
        .object({
          owner: z
            .number()
            .nullable()
            .optional()
            .describe("User ID to set as document owner, or null to remove ownership"),
          set_permissions: z
            .object({
              view: z
                .object({
                  users: z.array(z.number()).describe("User IDs granted view permission"),
                  groups: z.array(z.number()).describe("Group IDs granted view permission"),
                })
                .describe("Users and groups who can view these documents"),
              change: z
                .object({
                  users: z.array(z.number()).describe("User IDs granted edit permission"),
                  groups: z.array(z.number()).describe("Group IDs granted edit permission"),
                })
                .describe("Users and groups who can edit these documents"),
            })
            .optional()
            .describe("Specific permission settings for users and groups"),
          merge: z
            .boolean()
            .optional()
            .describe("Whether to merge with existing permissions (true) or replace them (false)"),
        })
        .optional()
        .describe(
          "Permission settings when method is 'set_permissions'. Controls who can view and edit the documents."
        ),
      metadata_document_id: z
        .number()
        .optional()
        .describe(
          "Source document ID when merging documents. The metadata from this document will be preserved."
        ),
      delete_originals: z
        .boolean()
        .optional()
        .describe(
          "Whether to delete original documents after merge/split operations. Use with caution."
        ),
      pages: z
        .string()
        .optional()
        .describe(
          "Page specification for delete_pages method. Format: '1,3,5-7' to delete pages 1, 3, and 5 through 7."
        ),
      degrees: z
        .number()
        .optional()
        .describe(
          "Rotation angle in degrees when method is 'rotate'. Use 90, 180, or 270 for standard rotations."
        ),
    },
    async (args) => {
      if (!api) throw new Error("Please configure API connection first");
      const { documents, method, ...parameters } = args;
      return asTextResult(
        await api.bulkEditDocuments(documents, method as BulkEditMethod, parameters)
      );
    }
  );

  server.tool(
    "post_document",
    "Upload a new document to Paperless-NGX with metadata. Supports PDF, images (PNG/JPG/TIFF), and text files. Automatically processes for OCR and indexing.",
    {
      file: z
        .string()
        .describe(
          "Base64 encoded file content. Convert your file to base64 before uploading. Supports PDF, images (PNG, JPG, TIFF), and text files."
        ),
      filename: z
        .string()
        .describe(
          "Original filename with extension (e.g., 'invoice.pdf', 'receipt.png'). This helps Paperless determine file type and initial document title."
        ),
      title: z
        .string()
        .optional()
        .describe(
          "Custom document title. If not provided, Paperless will extract title from filename or document content."
        ),
      created: z
        .string()
        .optional()
        .describe(
          "Document creation date in ISO format (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss). If not provided, uses current date."
        ),
      correspondent: z
        .number()
        .optional()
        .describe(
          "ID of the correspondent (sender/receiver) for this document. Use list_correspondents to find or create_correspondent to add new ones."
        ),
      document_type: z
        .number()
        .optional()
        .describe(
          "ID of document type for categorization (e.g., Invoice, Receipt, Letter). Use list_document_types to find or create_document_type to add new ones."
        ),
      storage_path: z
        .number()
        .optional()
        .describe(
          "ID of storage path to organize document location in folder hierarchy. Leave empty for default storage."
        ),
      tags: z
        .array(z.number())
        .optional()
        .describe(
          "Array of tag IDs to label this document. Use list_tags to find existing tags or create_tag to add new ones."
        ),
      archive_serial_number: z
        .string()
        .optional()
        .describe(
          "Custom archive number for document organization and reference. Useful for maintaining external filing systems."
        ),
      custom_fields: z
        .array(z.number())
        .optional()
        .describe(
          "Array of custom field IDs to associate with this document. Custom fields store additional metadata."
        ),
    },
    async (args) => {
      if (!api) throw new Error("Please configure API connection first");
      const binaryData = Buffer.from(args.file, "base64");
      const blob = new Blob([binaryData]);
      const file = new File([blob], args.filename);
      const { file: _f, filename: _n, ...metadata } = args;
      return asTextResult(await api.postDocument(file, metadata));
    }
  );

  server.tool(
    "get_document",
    "Get complete details for a specific document including full metadata, content preview, tags, correspondent, and document type information.",
    {
      id: z
        .number()
        .describe(
          "Unique document ID. Get this from search_documents results. Returns full document metadata, content preview, and associated tags/correspondent/type."
        ),
    },
    async (args) => {
      if (!api) throw new Error("Please configure API connection first");
      return asTextResult(await api.getDocument(args.id));
    }
  );

  server.tool(
    "search_documents",
    [
      "Full-text search across documents using Paperless-NGX's query DSL (Tantivy-based).",
      "Returns document metadata WITHOUT the full OCR `content` field to prevent token overflow — call get_document for full content.",
      "",
      "WHEN TO USE: free-text search ('find anything mentioning bitcoin'), or quick filters expressible as DSL terms.",
      "WHEN TO USE filter_documents INSTEAD: typed comparisons on custom fields (e.g. amount > 100), 'must have ALL these tags', 'has no correspondent', filtering by inbox/owner/mime, or any structured predicate the DSL can't express.",
      "",
      "QUERY DSL REFERENCE (all combinable, default operator is AND):",
      "  Field searches:",
      "    title:invoice          — search the title field",
      "    content:bitcoin        — search OCR content",
      "    type:invoice           — match document type by name",
      "    correspondent:bank     — match correspondent by name",
      "    tag:unpaid             — match tag by name (use multiple `tag:` for multiple tags)",
      "    asn:1234               — archive serial number",
      "    custom_fields.value:1312                 — match any custom field value",
      '    custom_fields.name:"Contract Number"      — match a specific named custom field (quote multi-word names)',
      "    custom_fields.name:Insurance custom_fields.value:policy   — combined: named field with specific value",
      "    notes.user:alice       — note author username",
      "    notes.note:reminder    — note content",
      "  Date fields (created, added, modified):",
      "    created:[2020 to 2024]                  — inclusive year range",
      "    created:[2024-01-01 to 2024-06-30]       — date range",
      "    added:yesterday                          — keyword",
      "    modified:today                           — keyword",
      '    modified:"this year"                     — multi-word keyword (quote it)',
      '    Other keywords: today, yesterday, "previous week", "this month", "previous month", "this year", "previous year", "previous quarter"',
      "    Note: custom date fields do NOT support relative date keywords — use filter_documents.custom_field_query with `range`/`gt`/`lt` for those.",
      "  Boolean operators (case-sensitive):",
      "    invoice AND unpaid",
      "    (invoice OR receipt) AND correspondent:bank",
      "    invoice NOT archived       (or use `-archived`)",
      "  Patterns:",
      "    prod*name              — `*` wildcard (zero or more chars)",
      '    "exact phrase"        — quoted exact-phrase match',
      "  Behavior notes:",
      "    - Word order doesn't matter; matching is accent-insensitive (résumé == resume) and separator-agnostic (1312 finds A-1312/B).",
      "    - Default scope: content, title, correspondent, type, tags, notes, custom field values.",
      "    - Fuzzy matching is server-side configurable (PAPERLESS_ADVANCED_FUZZY_SEARCH_THRESHOLD).",
      "",
      "EXAMPLES:",
      "  Unpaid invoices from 2024:                 type:invoice tag:unpaid created:[2024 to 2024]",
      '  Bank docs with a specific contract number: correspondent:bank custom_fields.name:"Contract Number" custom_fields.value:1312',
      '  Modified this week, noted by alice:        modified:"this week" notes.user:alice',
      "  Either invoices or receipts, not archived: (type:invoice OR type:receipt) NOT tag:archived",
    ].join("\n"),
    {
      query: z
        .string()
        .describe(
          "Paperless-NGX query DSL string. See tool description for full operator reference. Examples: 'type:invoice tag:unpaid', 'correspondent:bank created:[2024 to 2024]', 'custom_fields.name:\"Contract Number\" custom_fields.value:1312', '(type:invoice OR type:receipt) NOT tag:archived'."
        ),
      page: z
        .number()
        .optional()
        .describe(
          "Page number for pagination (starts at 1). Use to browse through large result sets without hitting token limits."
        ),
      page_size: z
        .number()
        .optional()
        .describe(
          "Number of documents per page (default 25, max 100). Smaller page sizes help avoid token limits when many documents match."
        ),
    },
    async (args) => {
      if (!api) throw new Error("Please configure API connection first");
      return asTextResult(await api.searchDocuments(args.query, args.page, args.page_size));
    }
  );

  const customFieldQuerySchema: z.ZodType<unknown> = z.lazy(() =>
    z.union([
      z
        .tuple([z.union([z.string(), z.number()]), z.string(), z.unknown()])
        .describe("Atomic predicate: [fieldRefIdOrName, operator, value]"),
      z
        .tuple([z.enum(["AND", "OR"]), z.array(customFieldQuerySchema)])
        .describe("Boolean group: ['AND'|'OR', [subqueries...]]"),
      z.tuple([z.literal("NOT"), customFieldQuerySchema]).describe("Negation: ['NOT', subquery]"),
    ])
  );

  server.tool(
    "filter_documents",
    [
      "Structured filtering of documents — use this when search_documents' DSL is insufficient.",
      "",
      "WHEN TO USE (vs. search_documents):",
      "  - Typed comparisons on custom fields: amount > 100, date in range, boolean true/false, 'is null', 'exists'.",
      "  - Strict tag-set requirements: 'documents that have ALL of tags [1,2,3]' (DSL can't enforce 'all').",
      "  - Negative filters: 'no correspondent', 'not in inbox', 'no tags assigned'.",
      "  - Structural facets: by owner, mime_type, original_filename, archive_serial_number, has_custom_fields.",
      "  - Date-bounded queries on standard fields with precise ISO dates.",
      "",
      "You may combine `query` (full-text DSL — same syntax as search_documents) with structured filters; results match BOTH.",
      "",
      "CUSTOM FIELD QUERY DSL (`custom_field_query` parameter):",
      "  Call list_custom_fields FIRST to discover available custom fields, their IDs, and data_type.",
      "  Shape — recursive, max depth 10, max 20 atoms total:",
      "    Atom:    [fieldRef, operator, value]      where fieldRef is the custom field's id (number) or name (string)",
      "    AND/OR:  ['AND', [subq1, subq2, ...]]      |  ['OR', [subq1, subq2, ...]]",
      "    NOT:     ['NOT', subquery]",
      "  Operators by field data_type:",
      "    string / url / longtext: exact, in, isnull, exists, icontains, istartswith, iendswith",
      "    integer / float:         exact, in, isnull, exists, gt, gte, lt, lte, range",
      "    date:                    exact, in, isnull, exists, gt, gte, lt, lte, range, year__exact, month__exact, day__exact",
      "    monetary:                exact, in, isnull, exists, icontains, istartswith, iendswith, gt, gte, lt, lte, range  (numeric compare strips currency)",
      "    boolean:                 exact, in, isnull, exists  (value: true/false)",
      "    select:                  exact, in, isnull, exists  (value: option id or label)",
      "    documentlink:            exact, in, isnull, exists, contains  (contains: subset check on linked-document ids)",
      "  Examples:",
      "    Date range:    ['due', 'range', ['2024-08-01', '2024-09-01']]",
      "    Numeric > :    ['Invoice Total', 'gt', 100]",
      "    Boolean true:  ['answered', 'exact', true]",
      "    Select in:     ['favorite animal', 'in', ['cat', 'dog']]",
      "    Empty/null:    ['OR', [['address', 'isnull', true], ['address', 'exact', '']]]",
      "    Field exists:  ['foo', 'exists', false]",
      "    Doc link:      ['references', 'contains', [3, 7]]",
      "    Combined:      ['AND', [['Invoice Total', 'gt', 100], ['status', 'exact', 'pending']]]",
      "",
      "STRUCTURED FILTERS reuse Django-ORM naming. Array params accept multiple ids and are comma-joined into the URL.",
    ].join("\n"),
    {
      query: z
        .string()
        .optional()
        .describe(
          "Optional full-text query (same Paperless DSL as search_documents). Combined with structured filters via AND."
        ),
      correspondent__id__in: z
        .array(z.number())
        .optional()
        .describe("Match documents whose correspondent is any of these IDs."),
      correspondent__isnull: z
        .boolean()
        .optional()
        .describe("True = documents with no correspondent assigned."),
      document_type__id__in: z
        .array(z.number())
        .optional()
        .describe("Match documents whose document type is any of these IDs."),
      document_type__isnull: z
        .boolean()
        .optional()
        .describe("True = documents with no document type assigned."),
      storage_path__id__in: z
        .array(z.number())
        .optional()
        .describe("Match documents stored at any of these storage path IDs."),
      tags__id__all: z
        .array(z.number())
        .optional()
        .describe("Documents must have ALL of these tag IDs (set intersection)."),
      tags__id__in: z
        .array(z.number())
        .optional()
        .describe("Documents have ANY of these tag IDs (set union)."),
      tags__id__none: z
        .array(z.number())
        .optional()
        .describe("Documents have NONE of these tag IDs (set exclusion)."),
      is_tagged: z.boolean().optional().describe("True = has at least one tag; false = untagged."),
      is_in_inbox: z
        .boolean()
        .optional()
        .describe("True = currently in the inbox (has the inbox tag)."),
      owner__id__in: z
        .array(z.number())
        .optional()
        .describe("Match documents owned by any of these user IDs."),
      owner__isnull: z.boolean().optional().describe("True = documents with no owner."),
      title__icontains: z
        .string()
        .optional()
        .describe("Case-insensitive substring match on title."),
      content__icontains: z
        .string()
        .optional()
        .describe(
          "Case-insensitive substring match on OCR content. Slow on large corpora — prefer search_documents `query` for content search."
        ),
      original_filename__icontains: z
        .string()
        .optional()
        .describe("Case-insensitive substring match on original uploaded filename."),
      archive_serial_number: z.string().optional().describe("Exact archive serial number match."),
      mime_type: z
        .string()
        .optional()
        .describe("Filter by MIME type (e.g. 'application/pdf', 'image/png')."),
      created__gte: z
        .string()
        .optional()
        .describe("Created on or after this date (ISO YYYY-MM-DD or full ISO datetime)."),
      created__lte: z
        .string()
        .optional()
        .describe("Created on or before this date (ISO YYYY-MM-DD or full ISO datetime)."),
      added__gte: z
        .string()
        .optional()
        .describe("Added to Paperless on or after this date (ISO format)."),
      added__lte: z
        .string()
        .optional()
        .describe("Added to Paperless on or before this date (ISO format)."),
      modified__gte: z
        .string()
        .optional()
        .describe("Last modified on or after this date (ISO format)."),
      modified__lte: z
        .string()
        .optional()
        .describe("Last modified on or before this date (ISO format)."),
      has_custom_fields: z
        .boolean()
        .optional()
        .describe("True = has at least one custom field assigned."),
      custom_fields__id__all: z
        .array(z.number())
        .optional()
        .describe(
          "Documents must have ALL these custom field IDs assigned (existence, not value — use custom_field_query for value predicates)."
        ),
      custom_field_query: customFieldQuerySchema
        .optional()
        .describe(
          "Typed predicate tree on custom field VALUES. See tool description for full operator/shape reference. Call list_custom_fields first to learn field names/types/select options. Example: ['AND', [['Invoice Total', 'gt', 100], ['status', 'exact', 'pending']]]."
        ),
      ordering: z
        .string()
        .optional()
        .describe(
          "Sort field. Prefix with '-' for descending. Common: 'created', '-created', 'title', '-modified', 'archive_serial_number'."
        ),
      page: z.number().optional().describe("Pagination page (1-based)."),
      page_size: z.number().optional().describe("Items per page (default 25, max 100)."),
    },
    async (args) => {
      if (!api) throw new Error("Please configure API connection first");
      return asTextResult(await api.filterDocuments(args));
    }
  );

  server.tool(
    "download_document",
    "Download a document file as base64-encoded data. Choose between original uploaded file or processed/archived version with OCR improvements.",
    {
      id: z
        .number()
        .describe(
          "Document ID to download. Get this from search_documents or get_document results."
        ),
      original: z
        .boolean()
        .optional()
        .describe(
          "Whether to download the original uploaded file (true) or the processed/archived version (false, default). Original files preserve exact formatting but may not include OCR improvements."
        ),
    },
    async (args) => {
      if (!api) throw new Error("Please configure API connection first");
      const response = await api.downloadDocument(args.id, args.original);
      const filename =
        response.headers.get("content-disposition")?.split("filename=")[1]?.replace(/"/g, "") ||
        `document-${args.id}`;
      return asTextResult({
        blob: Buffer.from(await response.arrayBuffer()).toString("base64"),
        filename,
      });
    }
  );
}
