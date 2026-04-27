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

export class PaperlessAPI {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string
  ) {}

  async request(path: string, options: RequestInit = {}): Promise<unknown> {
    const url = `${this.baseUrl}/api${path}`;
    const headers: Record<string, string> = {
      Authorization: `Token ${this.token}`,
      Accept: "application/json; version=5",
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

    if (!response.ok) {
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
