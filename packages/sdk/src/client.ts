import {
  PUBLIC_API_VERSION,
  type ApiDeadlinesData,
  type ApiEnvelope,
  type ApiErrorEnvelope,
  type ApiEvidenceData,
  type ApiExportFormat,
  type ApiGraphData,
  type ApiHistoryData,
  type ApiQuery,
  type ApiRecordData,
  type ApiRegistryDetail,
  type ApiRegistrySummary,
  type ApiRelationshipsData,
  type ApiSearchData,
} from "@civic-registry/api";

export interface CivicRegistryClientOptions {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
  headers?: HeadersInit;
}

export interface ExportRequest
  extends ApiQuery {
  format?: ApiExportFormat;
  maxRecords?: number;
}

export interface ExportResponse {
  body: string;
  contentType: string;
  filename?: string;
  total?: number;
  exported?: number;
  truncated: boolean;
}

export class CivicRegistryApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues?: ApiErrorEnvelope["error"]["issues"];

  constructor(
    status: number,
    error: ApiErrorEnvelope["error"],
  ) {
    super(error.message);
    this.name = "CivicRegistryApiError";
    this.status = status;
    this.code = error.code;
    this.issues = error.issues;
  }
}

function apiBaseUrl(
  value: string,
): string {
  const trimmed = value.replace(/\/+$/, "");

  if (!trimmed) {
    return "/api/v1";
  }

  if (trimmed.endsWith("/api/v1")) {
    return trimmed;
  }

  return `${trimmed}/api/v1`;
}

function encodeSegment(
  value: string,
): string {
  return encodeURIComponent(value);
}

function appendQuery(
  path: string,
  query: ApiQuery | undefined,
): string {
  if (!query) return path;

  const search = new URLSearchParams();

  for (const [key, raw] of Object.entries(query)) {
    if (raw === undefined || raw === null) {
      continue;
    }

    const values = Array.isArray(raw)
      ? raw
      : [raw];

    for (const value of values) {
      search.append(key, String(value));
    }
  }

  const suffix = search.toString();
  return suffix
    ? `${path}?${suffix}`
    : path;
}

function optionalNumberHeader(
  response: Response,
  name: string,
): number | undefined {
  const raw = response.headers.get(name);

  if (raw === null || raw.trim() === "") {
    return undefined;
  }

  const parsed = Number(raw);

  return Number.isFinite(parsed)
    ? parsed
    : undefined;
}

function fileNameFromDisposition(
  value: string | null,
): string | undefined {
  if (!value) return undefined;

  const utf8 = value.match(
    /filename\*=UTF-8''([^;]+)/i,
  );

  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      return utf8[1];
    }
  }

  const plain = value.match(
    /filename="?([^";]+)"?/i,
  );

  return plain?.[1];
}

export class CivicRegistryClient {
  readonly apiVersion = PUBLIC_API_VERSION;
  readonly baseUrl: string;

  private readonly fetcher: typeof globalThis.fetch;
  private readonly headers: Headers;

  constructor(
    options: CivicRegistryClientOptions,
  ) {
    this.baseUrl = apiBaseUrl(
      options.baseUrl,
    );
    const fetcher =
      options.fetch ??
      globalThis.fetch;

    if (!fetcher) {
      throw new Error(
        "A fetch implementation is required.",
      );
    }

    this.fetcher = fetcher;
    this.headers = new Headers(
      options.headers ?? {},
    );
  }

  private async response(
    path: string,
  ): Promise<Response> {
    const requestHeaders =
      new Headers(this.headers);

    if (!requestHeaders.has("Accept")) {
      requestHeaders.set(
        "Accept",
        "application/json",
      );
    }

    const response = await this.fetcher(
      `${this.baseUrl}${path}`,
      {
        method: "GET",
        headers: requestHeaders,
      },
    );

    if (response.ok) {
      return response;
    }

    let payload:
      | ApiErrorEnvelope
      | undefined;

    try {
      payload =
        (await response.json()) as
          ApiErrorEnvelope;
    } catch {
      payload = undefined;
    }

    throw new CivicRegistryApiError(
      response.status,
      payload?.error ?? {
        code: "http_error",
        message:
          `Public API request failed with HTTP ${response.status}.`,
      },
    );
  }

  private async json<T>(
    path: string,
  ): Promise<T> {
    const response =
      await this.response(path);
    const payload =
      (await response.json()) as
        ApiEnvelope<T>;

    if (
      payload.apiVersion !==
      PUBLIC_API_VERSION
    ) {
      throw new Error(
        `Unsupported public API version: ${String(payload.apiVersion)}.`,
      );
    }

    return payload.data;
  }

  listRegistries(): Promise<
    ApiRegistrySummary[]
  > {
    return this.json("/registries");
  }

  getRegistry(
    registryId: string,
  ): Promise<ApiRegistryDetail> {
    return this.json(
      `/registries/${encodeSegment(registryId)}`,
    );
  }

  listRecords(
    registryId: string,
    query?: ApiQuery,
  ): Promise<ApiSearchData> {
    return this.json(
      appendQuery(
        `/registries/${encodeSegment(registryId)}/records`,
        query,
      ),
    );
  }

  search(
    registryId: string,
    query?: ApiQuery,
  ): Promise<ApiSearchData> {
    return this.json(
      appendQuery(
        `/registries/${encodeSegment(registryId)}/search`,
        query,
      ),
    );
  }

  getRecord(
    registryId: string,
    recordId: string,
  ): Promise<ApiRecordData> {
    return this.json(
      `/registries/${encodeSegment(registryId)}/records/${encodeSegment(recordId)}`,
    );
  }

  getEvidence(
    registryId: string,
    recordId: string,
  ): Promise<ApiEvidenceData> {
    return this.json(
      `/registries/${encodeSegment(registryId)}/records/${encodeSegment(recordId)}/evidence`,
    );
  }

  getHistory(
    registryId: string,
    recordId: string,
  ): Promise<ApiHistoryData> {
    return this.json(
      `/registries/${encodeSegment(registryId)}/records/${encodeSegment(recordId)}/history`,
    );
  }

  getRelationships(
    registryId: string,
    recordId: string,
    query?: ApiQuery,
  ): Promise<ApiRelationshipsData> {
    return this.json(
      appendQuery(
        `/registries/${encodeSegment(registryId)}/records/${encodeSegment(recordId)}/relationships`,
        query,
      ),
    );
  }

  getGraph(
    registryId: string,
    recordId: string,
    query?: ApiQuery,
  ): Promise<ApiGraphData> {
    return this.json(
      appendQuery(
        `/registries/${encodeSegment(registryId)}/records/${encodeSegment(recordId)}/graph`,
        query,
      ),
    );
  }

  getDeadlines(
    registryId: string,
    recordId: string,
  ): Promise<ApiDeadlinesData> {
    return this.json(
      `/registries/${encodeSegment(registryId)}/records/${encodeSegment(recordId)}/deadlines`,
    );
  }

  async exportRecords(
    registryId: string,
    request: ExportRequest = {},
  ): Promise<ExportResponse> {
    const response = await this.response(
      appendQuery(
        `/registries/${encodeSegment(registryId)}/export`,
        request,
      ),
    );
    const body = await response.text();

    return {
      body,
      contentType:
        response.headers.get(
          "Content-Type",
        ) ?? "application/octet-stream",
      filename:
        fileNameFromDisposition(
          response.headers.get(
            "Content-Disposition",
          ),
        ),
      total: optionalNumberHeader(
        response,
        "X-Export-Total",
      ),
      exported: optionalNumberHeader(
        response,
        "X-Export-Count",
      ),
      truncated:
        response.headers.get(
          "X-Export-Truncated",
        ) === "true",
    };
  }

  async getOpenApiDocument(): Promise<
    Record<string, unknown>
  > {
    const response = await this.response(
      "/openapi.json",
    );

    return (await response.json()) as
      Record<string, unknown>;
  }
}
