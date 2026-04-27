export type BulkEditMethod =
  | "set_correspondent"
  | "set_document_type"
  | "set_storage_path"
  | "add_tag"
  | "remove_tag"
  | "modify_tags"
  | "delete"
  | "reprocess"
  | "set_permissions"
  | "merge"
  | "split"
  | "rotate"
  | "delete_pages";

export type BulkObjectType = "tags" | "correspondents" | "document_types";
export type BulkObjectOperation = "set_permissions" | "delete";

export interface DocumentMetadata {
  title?: string;
  created?: string;
  correspondent?: string | number;
  document_type?: string | number;
  storage_path?: string | number;
  tags?: Array<string | number>;
  archive_serial_number?: string;
  custom_fields?: Array<string | number>;
}

export interface PaperlessAPIOptions {
  /**
   * Initial Paperless API version sent in `Accept: application/json; version=<n>`.
   * Acts as a ceiling — auto-negotiation may downgrade to what the server reports
   * via `X-Api-Version`, but never upgrades past this value. Defaults to "10".
   */
  apiVersion?: string;
}

/** Minimum API version that supports `custom_field_query` and `/api/custom_fields/`. */
export const CUSTOM_FIELD_QUERY_MIN_VERSION = 9;

export class PaperlessAPI {
  private apiVersion: string;

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    options: PaperlessAPIOptions = {}
  ) {
    this.apiVersion = options.apiVersion ?? "10";
  }

  /** Negotiated API version currently in use (may be downgraded from initial). */
  getApiVersion(): string {
    return this.apiVersion;
  }

  /**
   * Throw a clear error if the negotiated API version is below the minimum required
   * for a feature. Avoids cryptic 400/406 responses from the server.
   */
  requireApiVersion(min: number, feature: string): void {
    const current = Number.parseInt(this.apiVersion, 10);
    if (Number.isNaN(current) || current < min) {
      throw new Error(
        `Feature "${feature}" requires Paperless API version ${min} or higher, but the server is using version ${this.apiVersion}. Upgrade your Paperless-NGX instance or pass --api-version with a compatible value.`
      );
    }
  }

  async request(path: string, options: RequestInit = {}): Promise<unknown> {
    return this.#requestWithVersion(path, options, this.apiVersion, /* allowRetry */ true);
  }

  async #requestWithVersion(
    path: string,
    options: RequestInit,
    version: string,
    allowRetry: boolean
  ): Promise<unknown> {
    const url = `${this.baseUrl}/api${path}`;
    const headers: Record<string, string> = {
      Authorization: `Token ${this.token}`,
      Accept: `application/json; version=${version}`,
      "Content-Type": "application/json",
      "Accept-Language": "en-US,en;q=0.9",
    };

    const response = await fetch(url, {
      ...options,
      headers: {
        ...headers,
        ...(options.headers as Record<string, string> | undefined),
      },
    });

    // Auto-negotiation: trust the server's reported max API version. Downgrade only —
    // never upgrade past the user-configured ceiling, even if the server supports more.
    const serverMax = response.headers.get("x-api-version");
    if (serverMax) {
      const serverMaxNum = Number.parseInt(serverMax, 10);
      const currentNum = Number.parseInt(this.apiVersion, 10);
      if (!Number.isNaN(serverMaxNum) && !Number.isNaN(currentNum) && serverMaxNum < currentNum) {
        this.apiVersion = serverMax;
      }
    }

    if (!response.ok) {
      // 406 Not Acceptable from DRF means the version we sent is not in ALLOWED_VERSIONS.
      // If the server told us its max via X-Api-Version and it differs from what we sent,
      // retry once at that version. This recovers from a stale ceiling on the very first call.
      if (response.status === 406 && allowRetry && serverMax && serverMax !== version) {
        this.apiVersion = serverMax;
        return this.#requestWithVersion(path, options, serverMax, /* allowRetry */ false);
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }
      // SECURITY: never log headers/options here — they contain the auth token.
      console.error({
        error: "Error executing request",
        url,
        method: options.method ?? "GET",
        status: response.status,
        response: body,
      });
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  async bulkEditDocuments(
    documents: number[],
    method: BulkEditMethod,
    parameters: Record<string, unknown> = {}
  ): Promise<unknown> {
    return this.request("/documents/bulk_edit/", {
      method: "POST",
      body: JSON.stringify({
        documents,
        method,
        parameters,
      }),
    });
  }

  async postDocument(file: File, metadata: DocumentMetadata = {}): Promise<unknown> {
    const formData = new FormData();
    formData.append("document", file);

    if (metadata.title !== undefined) formData.append("title", metadata.title);
    if (metadata.created !== undefined) formData.append("created", metadata.created);
    if (metadata.correspondent !== undefined)
      formData.append("correspondent", String(metadata.correspondent));
    if (metadata.document_type !== undefined)
      formData.append("document_type", String(metadata.document_type));
    if (metadata.storage_path !== undefined)
      formData.append("storage_path", String(metadata.storage_path));
    if (metadata.tags) {
      for (const tag of metadata.tags) {
        formData.append("tags", String(tag));
      }
    }
    if (metadata.archive_serial_number !== undefined) {
      formData.append("archive_serial_number", metadata.archive_serial_number);
    }
    if (metadata.custom_fields) {
      for (const field of metadata.custom_fields) {
        formData.append("custom_fields", String(field));
      }
    }

    const response = await fetch(`${this.baseUrl}/api/documents/post_document/`, {
      method: "POST",
      headers: {
        Authorization: `Token ${this.token}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  async getDocuments(query = ""): Promise<unknown> {
    return this.request(`/documents/${query}`);
  }

  async getDocument(id: number): Promise<unknown> {
    return this.request(`/documents/${id}/`);
  }

  /**
   * Full-text search. Strips `content`, `download_url`, `thumbnail_url` from results to
   * stay under MCP token limits — removing this stripping is a breaking change for callers.
   */
  async searchDocuments(query: string, page?: number, pageSize?: number): Promise<unknown> {
    const params = new URLSearchParams();
    params.set("query", query);
    if (page !== undefined) params.set("page", page.toString());
    if (pageSize !== undefined) params.set("page_size", pageSize.toString());

    const response = (await this.request(`/documents/?${params.toString()}`)) as {
      results?: Array<Record<string, unknown>>;
      [key: string]: unknown;
    };

    if (response.results) {
      response.results = response.results.map((doc) => {
        const { content: _content, download_url: _d, thumbnail_url: _t, ...rest } = doc;
        return rest;
      });
    }

    return response;
  }

  /**
   * Structured document filtering against `/api/documents/`. Supports Django-ORM-style
   * filter parameters (e.g. `tags__id__all=[1,2]`, `correspondent__id__in=[3]`,
   * `created__gte="2024-01-01"`, `is_in_inbox=true`) plus the `custom_field_query` JSON DSL
   * for typed predicates against custom fields.
   *
   * Array values are emitted as repeated query parameters (Django's `__in` / `__all` /
   * `__none` convention). `custom_field_query` is JSON-encoded into a single value.
   * Booleans are stringified as `true` / `false`.
   *
   * Strips `content`, `download_url`, `thumbnail_url` from results — same token-budget
   * protection as `searchDocuments`. Removing this stripping is a breaking change.
   */
  async filterDocuments(params: Record<string, unknown>): Promise<unknown> {
    if (params.custom_field_query !== undefined) {
      this.requireApiVersion(CUSTOM_FIELD_QUERY_MIN_VERSION, "custom_field_query");
    }
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      if (key === "custom_field_query") {
        search.set(key, JSON.stringify(value));
        continue;
      }
      if (Array.isArray(value)) {
        // Django filter convention: repeat the param for each value, comma-joined for *__id__in style
        // Paperless accepts both repeated params and comma-joined; comma-joined is more compact.
        search.set(key, value.map((v) => String(v)).join(","));
        continue;
      }
      if (typeof value === "boolean") {
        search.set(key, value ? "true" : "false");
        continue;
      }
      search.set(key, String(value));
    }

    const qs = search.toString();
    const path = qs.length > 0 ? `/documents/?${qs}` : "/documents/";
    const response = (await this.request(path)) as {
      results?: Array<Record<string, unknown>>;
      [key: string]: unknown;
    };

    if (response.results) {
      response.results = response.results.map((doc) => {
        const { content: _content, download_url: _d, thumbnail_url: _t, ...rest } = doc;
        return rest;
      });
    }

    return response;
  }

  async getCustomFields(): Promise<unknown> {
    this.requireApiVersion(CUSTOM_FIELD_QUERY_MIN_VERSION, "list_custom_fields");
    return this.request("/custom_fields/");
  }

  async downloadDocument(id: number, asOriginal = false): Promise<Response> {
    const query = asOriginal ? "?original=true" : "";
    return fetch(`${this.baseUrl}/api/documents/${id}/download/${query}`, {
      headers: {
        Authorization: `Token ${this.token}`,
      },
    });
  }

  async getTags(): Promise<unknown> {
    return this.request("/tags/");
  }

  async createTag(data: Record<string, unknown>): Promise<unknown> {
    return this.request("/tags/", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateTag(id: number, data: Record<string, unknown>): Promise<unknown> {
    return this.request(`/tags/${id}/`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteTag(id: number): Promise<unknown> {
    return this.request(`/tags/${id}/`, {
      method: "DELETE",
    });
  }

  async getCorrespondents(): Promise<unknown> {
    return this.request("/correspondents/");
  }

  async createCorrespondent(data: Record<string, unknown>): Promise<unknown> {
    return this.request("/correspondents/", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getDocumentTypes(): Promise<unknown> {
    return this.request("/document_types/");
  }

  async createDocumentType(data: Record<string, unknown>): Promise<unknown> {
    return this.request("/document_types/", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async bulkEditObjects(
    objects: number[],
    objectType: BulkObjectType,
    operation: BulkObjectOperation,
    parameters: Record<string, unknown> = {}
  ): Promise<unknown> {
    return this.request("/bulk_edit_objects/", {
      method: "POST",
      body: JSON.stringify({
        objects,
        object_type: objectType,
        operation,
        ...parameters,
      }),
    });
  }
}
