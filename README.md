# Paperless-NGX MCP Server

An MCP (Model Context Protocol) server for interacting with a Paperless-NGX API server. This server provides tools for managing documents, tags, correspondents, and document types in your Paperless-NGX instance.

## Quick Start

### Installation
1. Install the MCP server:
```bash
npm install -g @dellle/paperless-mcp
```

2. Add it to your Claude's MCP configuration:

For VSCode extension, edit `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`:
```json
{
  "mcpServers": {
    "paperless": {
      "command": "npx",
      "args": ["-y", "@dellle/paperless-mcp", "http://your-paperless-instance:8000", "your-api-token"]
    }
  }
}
```

For Claude desktop app, edit `~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "paperless": {
      "command": "npx",
      "args": ["-y", "@dellle/paperless-mcp", "http://your-paperless-instance:8000", "your-api-token"]
    }
  }
}
```

3. Get your API token:
   1. Log into your Paperless-NGX instance
   2. Click your username in the top right
   3. Select "My Profile"
   4. Click the circular arrow button to generate a new token

4. Replace the placeholders in your MCP config:
   - `http://your-paperless-instance:8000` with your Paperless-NGX URL
   - `your-api-token` with the token you just generated

That's it! Now you can ask Claude to help you manage your Paperless-NGX documents.

## Example Usage

Here are some things you can ask Claude to do:

- "Show me all documents tagged as 'Invoice'"
- "Search for documents containing 'tax return'"
- "Create a new tag called 'Receipts' with color #FF0000"
- "Download document #123"
- "List all correspondents"
- "Create a new document type called 'Bank Statement'"

## Available Tools

### Document Operations

#### list_documents
Get a paginated list of all documents.

Parameters:
- page (optional): Page number
- page_size (optional): Number of documents per page

```typescript
list_documents({
  page: 1,
  page_size: 25
})
```

#### get_document
Get a specific document by ID.

Parameters:
- id: Document ID

```typescript
get_document({
  id: 123
})
```

#### search_documents
Full-text search across documents using the Paperless-NGX query DSL (Tantivy-based).

Returns metadata WITHOUT the OCR `content` field to protect token budgets — call `get_document` for full content.

Use `search_documents` for free-text queries; use `filter_documents` for typed/structured predicates (numeric custom fields, "must have ALL tags", "no correspondent", etc.).

Parameters:
- query: Paperless-NGX DSL string (see syntax below)
- page (optional)
- page_size (optional)

Query DSL — all combinable, default operator is AND:

| Field | Example | Notes |
|---|---|---|
| `title:` / `content:` | `title:invoice` | Search title or OCR content |
| `type:` | `type:invoice` | Match document type by name |
| `correspondent:` | `correspondent:bank` | Match correspondent by name |
| `tag:` | `tag:unpaid` | Repeat for multiple tags |
| `asn:` | `asn:1234` | Archive serial number |
| `custom_fields.value:` | `custom_fields.value:1312` | Match any custom field value |
| `custom_fields.name:` | `custom_fields.name:"Contract Number"` | Quote multi-word names |
| `notes.user:` / `notes.note:` | `notes.user:alice` | Note author or content |
| `created:` / `added:` / `modified:` | `created:[2020 to 2024]` | Inclusive range |
| Date keywords | `added:yesterday`, `modified:"this year"` | `today`, `yesterday`, `"previous week"`, `"this month"`, `"previous month"`, `"this year"`, `"previous year"`, `"previous quarter"` |
| Booleans | `invoice AND unpaid`, `(a OR b) NOT c` | Case-sensitive operators |
| Wildcards | `prod*name` | `*` = zero or more chars |
| Exact phrase | `"Contract Number"` | Quoted |

Notes: matching is accent-insensitive (`resume` finds `résumé`) and separator-agnostic (`1312` finds `A-1312/B`). Custom date fields do **not** support relative date keywords — use `filter_documents.custom_field_query` with `range`/`gt`/`lt` instead.

```typescript
search_documents({
  query: 'type:invoice tag:unpaid created:[2024 to 2024]'
})

search_documents({
  query: 'correspondent:bank custom_fields.name:"Contract Number" custom_fields.value:1312'
})
```

#### filter_documents
Structured filtering of documents — use this when the DSL of `search_documents` is insufficient.

When to prefer `filter_documents`:
- Typed comparisons on custom fields: `amount > 100`, date in range, boolean true/false, `is null`, `exists`.
- Strict tag-set requirements: documents that have **ALL** of tags `[1,2,3]`.
- Negative filters: no correspondent, not in inbox, no tags assigned.
- Structural facets: by owner, mime_type, original_filename, archive_serial_number, has_custom_fields.
- Date-bounded queries on standard fields with precise ISO dates.

Parameters (all optional, all combined with AND):

| Param | Type | Description |
|---|---|---|
| `query` | string | Optional full-text DSL — combined with structured filters |
| `correspondent__id__in` | number[] | Match any of these correspondent IDs |
| `correspondent__isnull` | boolean | True = no correspondent |
| `document_type__id__in` | number[] | Match any of these document type IDs |
| `document_type__isnull` | boolean | True = no document type |
| `storage_path__id__in` | number[] | Match any of these storage path IDs |
| `tags__id__all` | number[] | Must have **all** these tag IDs |
| `tags__id__in` | number[] | Has **any** of these tag IDs |
| `tags__id__none` | number[] | Has **none** of these tag IDs |
| `is_tagged` | boolean | Has at least one tag |
| `is_in_inbox` | boolean | Currently in inbox |
| `owner__id__in` | number[] | Owned by any of these user IDs |
| `owner__isnull` | boolean | No owner |
| `title__icontains` | string | Case-insensitive substring |
| `content__icontains` | string | Case-insensitive substring on OCR content |
| `original_filename__icontains` | string | |
| `archive_serial_number` | string | Exact match |
| `mime_type` | string | e.g. `application/pdf` |
| `created__gte` / `created__lte` | string | ISO date or datetime |
| `added__gte` / `added__lte` | string | |
| `modified__gte` / `modified__lte` | string | |
| `has_custom_fields` | boolean | |
| `custom_fields__id__all` | number[] | Must have all these custom fields **assigned** (existence, not value) |
| `custom_field_query` | JSON tree | Typed predicates on custom field **values** — see below |
| `ordering` | string | e.g. `-created`, `title` |
| `page`, `page_size` | number | |

`custom_field_query` is a recursive JSON tree (max depth 10, max 20 atoms total):

```
Atom:    [fieldRef, operator, value]    where fieldRef = custom field id (number) or name (string)
AND/OR:  ["AND", [subq, ...]]   |   ["OR", [subq, ...]]
NOT:     ["NOT", subquery]
```

Operators by `data_type` (call `list_custom_fields` to discover field types):

| data_type | operators |
|---|---|
| string / url / longtext | exact, in, isnull, exists, icontains, istartswith, iendswith |
| integer / float | exact, in, isnull, exists, gt, gte, lt, lte, range |
| date | exact, in, isnull, exists, gt, gte, lt, lte, range, year__exact, month__exact, day__exact |
| monetary | numeric ops + icontains/istartswith/iendswith (currency stripped for compare) |
| boolean | exact, in, isnull, exists |
| select | exact, in, isnull, exists (value is option id or label) |
| documentlink | exact, in, isnull, exists, contains (subset check on linked document ids) |

```typescript
// All unpaid invoices from a specific correspondent, must have BOTH "urgent" and "review" tags
filter_documents({
  correspondent__id__in: [3],
  document_type__id__in: [7],
  tags__id__all: [12, 19],
  is_in_inbox: true,
})

// Custom field value predicate: Invoice Total > 100 AND status = pending
filter_documents({
  custom_field_query: ["AND", [
    ["Invoice Total", "gt", 100],
    ["status", "exact", "pending"]
  ]]
})

// Combined full-text + structured
filter_documents({
  query: "tax",
  created__gte: "2024-01-01",
  has_custom_fields: true,
  ordering: "-created"
})
```

#### list_custom_fields
List all custom fields defined in this Paperless instance. **Call this before building a `custom_field_query`** — it returns each field's `id`, `name`, `data_type`, and `extra_data` (e.g. select options).

```typescript
list_custom_fields()
```

#### download_document
Download a document file by ID.

Parameters:
- id: Document ID
- original (optional): If true, downloads original file instead of archived version

```typescript
download_document({
  id: 123,
  original: false
})
```

#### bulk_edit_documents
Perform bulk operations on multiple documents.

Parameters:
- documents: Array of document IDs
- method: One of:
  - set_correspondent: Set correspondent for documents
  - set_document_type: Set document type for documents
  - set_storage_path: Set storage path for documents
  - add_tag: Add a tag to documents
  - remove_tag: Remove a tag from documents
  - modify_tags: Add and/or remove multiple tags
  - delete: Delete documents
  - reprocess: Reprocess documents
  - set_permissions: Set document permissions
  - merge: Merge multiple documents
  - split: Split a document into multiple documents
  - rotate: Rotate document pages
  - delete_pages: Delete specific pages from a document
- Additional parameters based on method:
  - correspondent: ID for set_correspondent
  - document_type: ID for set_document_type
  - storage_path: ID for set_storage_path
  - tag: ID for add_tag/remove_tag
  - add_tags: Array of tag IDs for modify_tags
  - remove_tags: Array of tag IDs for modify_tags
  - permissions: Object for set_permissions with owner, permissions, merge flag
  - metadata_document_id: ID for merge to specify metadata source
  - delete_originals: Boolean for merge/split
  - pages: String for split "[1,2-3,4,5-7]" or delete_pages "[2,3,4]"
  - degrees: Number for rotate (90, 180, or 270)

Examples:
```typescript
// Add a tag to multiple documents
bulk_edit_documents({
  documents: [1, 2, 3],
  method: "add_tag",
  tag: 5
})

// Set correspondent and document type
bulk_edit_documents({
  documents: [4, 5],
  method: "set_correspondent",
  correspondent: 2
})

// Merge documents
bulk_edit_documents({
  documents: [6, 7, 8],
  method: "merge",
  metadata_document_id: 6,
  delete_originals: true
})

// Split document into parts
bulk_edit_documents({
  documents: [9],
  method: "split",
  pages: "[1-2,3-4,5]"
})

// Modify multiple tags at once
bulk_edit_documents({
  documents: [10, 11],
  method: "modify_tags",
  add_tags: [1, 2],
  remove_tags: [3, 4]
})
```

#### post_document
Upload a new document to Paperless-NGX.

Parameters:
- file: Base64 encoded file content
- filename: Name of the file
- title (optional): Title for the document
- created (optional): DateTime when the document was created (e.g. "2024-01-19" or "2024-01-19 06:15:00+02:00")
- correspondent (optional): ID of a correspondent
- document_type (optional): ID of a document type
- storage_path (optional): ID of a storage path
- tags (optional): Array of tag IDs
- archive_serial_number (optional): Archive serial number
- custom_fields (optional): Array of custom field IDs

```typescript
post_document({
  file: "base64_encoded_content",
  filename: "invoice.pdf",
  title: "January Invoice",
  created: "2024-01-19",
  correspondent: 1,
  document_type: 2,
  tags: [1, 3],
  archive_serial_number: "2024-001"
})
```

### Tag Operations

#### list_tags
Get all tags.

```typescript
list_tags()
```

#### create_tag
Create a new tag.

Parameters:
- name: Tag name
- color (optional): Hex color code (e.g. "#ff0000")
- match (optional): Text pattern to match
- matching_algorithm (optional): One of "any", "all", "exact", "regular expression", "fuzzy"

```typescript
create_tag({
  name: "Invoice",
  color: "#ff0000",
  match: "invoice",
  matching_algorithm: "fuzzy"
})
```

### Correspondent Operations

#### list_correspondents
Get all correspondents.

```typescript
list_correspondents()
```

#### create_correspondent
Create a new correspondent.

Parameters:
- name: Correspondent name
- match (optional): Text pattern to match
- matching_algorithm (optional): One of "any", "all", "exact", "regular expression", "fuzzy"

```typescript
create_correspondent({
  name: "ACME Corp",
  match: "ACME",
  matching_algorithm: "fuzzy"
})
```

### Document Type Operations

#### list_document_types
Get all document types.

```typescript
list_document_types()
```

#### create_document_type
Create a new document type.

Parameters:
- name: Document type name
- match (optional): Text pattern to match
- matching_algorithm (optional): One of "any", "all", "exact", "regular expression", "fuzzy"

```typescript
create_document_type({
  name: "Invoice",
  match: "invoice total amount due",
  matching_algorithm: "any"
})
```

## Error Handling

The server will show clear error messages if:
- The Paperless-NGX URL or API token is incorrect
- The Paperless-NGX server is unreachable
- The requested operation fails
- The provided parameters are invalid

## Development

Want to contribute or modify the server? Here's what you need to know:

1. Clone the repository
2. Install dependencies:
```bash
npm install
```

3. Make your changes to server.js
4. Test locally:
```bash
node server.js http://localhost:8000 your-test-token
```

The server is built with:
- [litemcp](https://github.com/wong2/litemcp): A TypeScript framework for building MCP servers
- [zod](https://github.com/colinhacks/zod): TypeScript-first schema validation

## API Documentation

This MCP server implements endpoints from the Paperless-NGX REST API. For more details about the underlying API, see the [official documentation](https://docs.paperless-ngx.com/api/).

## Running the MCP Server

The MCP server can be run in two modes:

### 1. stdio (default)

This is the default mode. The server communicates over stdio, suitable for CLI and direct integrations.

```
npm run start -- <baseUrl> <token>
```

### 2. HTTP (Streamable HTTP Transport)

To run the server as an HTTP service, use the `--http` flag. You can also specify the port with `--port` (default: 3000). This mode requires [Express](https://expressjs.com/) to be installed (it is included as a dependency).

```
npm run start -- <baseUrl> <token> --http --port 3000
```

- The MCP API will be available at `POST /mcp` on the specified port.
- Each request is handled statelessly, following the [StreamableHTTPServerTransport](https://github.com/modelcontextprotocol/typescript-sdk) pattern.
- GET and DELETE requests to `/mcp` will return 405 Method Not Allowed.

## API Version Compatibility

Paperless-NGX uses Accept-header API versioning (`Accept: application/json; version=<n>`). This MCP server defaults to **version 10**, which is what current Paperless-NGX servers support and what `filter_documents.custom_field_query` / `list_custom_fields` require (minimum version 9).

For older Paperless-NGX instances:

- The client **auto-negotiates downward**: every response includes an `X-Api-Version` header reporting the server's max supported version. If it's lower than the configured ceiling, subsequent requests are sent with that lower version automatically.
- If the very first request returns `406 Not Acceptable` (because the server doesn't accept the configured version at all), the client retries once at the version reported in `X-Api-Version`.
- The configured version is a **ceiling** — auto-negotiation only ever downgrades; it never upgrades past what you set.

You can override the default via:

```bash
paperless-mcp <baseUrl> <token> --api-version 9
# or, in --http mode:
PAPERLESS_API_VERSION=9 paperless-mcp <baseUrl> <token> --http
```

If your Paperless server is too old to support `custom_field_query` (i.e. negotiated version < 9), `filter_documents` (with `custom_field_query`) and `list_custom_fields` will return a clear error message — all other tools work normally.
