import type { PathMatcher } from "../helpers/harness";

/**
 * Fixture shapes mirror the actual Paperless-NGX REST API serializer output
 * (see `src/documents/serialisers.py` in the upstream repo). Fields are
 * production-accurate as of paperless-ngx main branch (2024+, API v10).
 *
 * Notes on what is and isn't real:
 *  - `download_url` and `thumbnail_url` are NOT serializer fields. They are
 *    intentionally omitted here. `searchDocuments` / `filterDocuments` strip
 *    them defensively, so tests that exercise that strip must inject those
 *    fields explicitly (see `tests/documents.test.ts`).
 *  - `created` is a date (`YYYY-MM-DD`), not a datetime; `modified` and `added`
 *    are datetimes with timezone.
 *  - The pagination envelope's `all: number[]` field is a Paperless-NGX
 *    extension to standard DRF pagination, present on API v9 and below; it is
 *    removed in v10+. The `paginated()` helper still emits it for back-compat.
 */

export const TAG: Record<string, unknown> = {
  id: 3,
  slug: "invoice",
  name: "Invoice",
  color: "#ff0000",
  text_color: "#ffffff",
  match: "invoice",
  matching_algorithm: 6,
  is_insensitive: true,
  is_inbox_tag: false,
  document_count: 12,
  parent: null,
  children: [],
  owner: 1,
  user_can_change: true,
};

export const CORRESPONDENT: Record<string, unknown> = {
  id: 1,
  slug: "acme-corp",
  name: "ACME Corp",
  match: "ACME",
  matching_algorithm: 6,
  is_insensitive: true,
  document_count: 5,
  last_correspondence: "2024-09-01",
  owner: 1,
  user_can_change: true,
};

export const DOCUMENT_TYPE: Record<string, unknown> = {
  id: 7,
  slug: "invoice",
  name: "Invoice",
  match: "invoice",
  matching_algorithm: 1,
  is_insensitive: true,
  document_count: 8,
  owner: 1,
  user_can_change: true,
};

export const CUSTOM_FIELD: Record<string, unknown> = {
  id: 1,
  name: "Invoice Total",
  data_type: "monetary",
  extra_data: { default_currency: null },
  document_count: 0,
};

export const DOCUMENT: Record<string, unknown> = {
  id: 42,
  correspondent: 1,
  document_type: 7,
  storage_path: null,
  title: "Receipt",
  content: "OCR text body",
  tags: [3],
  created: "2024-01-15",
  created_date: "2024-01-15",
  modified: "2024-01-15T00:00:00Z",
  added: "2024-01-15T12:00:00Z",
  deleted_at: null,
  archive_serial_number: null,
  original_file_name: "receipt.pdf",
  archived_file_name: "2024-01-15 Receipt.pdf",
  page_count: 1,
  mime_type: "application/pdf",
  root_document: null,
  versions: [],
  duplicate_documents: [],
  notes: [],
  custom_fields: [],
  owner: 1,
  user_can_change: true,
  is_shared_by_requester: false,
};

export function paginated<T>(
  results: T[],
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    count: results.length,
    next: null,
    previous: null,
    all: results
      .map((r) => (r as { id?: number }).id)
      .filter((id): id is number => typeof id === "number"),
    results,
    ...extra,
  };
}

export const EMPTY_PAGE: Record<string, unknown> = paginated([]);
export const OK: Record<string, unknown> = { result: "OK" };

export const PATH: Record<string, PathMatcher> = {
  documents: "/api/documents/",
  documentById: /^\/api\/documents\/\d+\/$/,
  documentsBulkEdit: "/api/documents/bulk_edit/",
  bulkEditObjects: "/api/bulk_edit_objects/",
  tags: "/api/tags/",
  tagById: /^\/api\/tags\/\d+\/$/,
  correspondents: "/api/correspondents/",
  documentTypes: "/api/document_types/",
  customFields: "/api/custom_fields/",
};
