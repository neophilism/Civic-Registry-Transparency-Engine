import {
  PUBLIC_API_VERSION,
  publicRegistryDetail,
  publicRegistrySummary,
  serializePublicRecordExport,
  type ApiEnvelope,
  type ApiErrorDetail,
  type ApiExportFormat,
  type ApiSearchData,
} from "@civic-registry/api";
import {
  SearchValidationError,
  type SearchRequest,
} from "@civic-registry/search";
import type {
  RegistryRecord,
} from "@civic-registry/core";

import {
  getPublicDeadlines,
  getPublicEvidence,
  getPublicHistory,
  getPublicRecordView,
  getPublicRegistry,
  getPublicRelationshipGraph,
  listPublicRegistries,
  listPublicRelationships,
  searchPublicRecords,
} from "./public-registry.ts";
import {
  parsePublicSearchRequest,
  type PublicSearchParams,
} from "./search-params.ts";
import {
  relationshipDepthParam,
  relationshipDirectionParam,
  relationshipValues,
  type RelationshipQueryParams,
} from "./relationship-params.ts";

const PUBLIC_API_BASE_HEADERS: Record<
  string,
  string
> = {
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers":
    "Accept, Content-Type",
  "Access-Control-Expose-Headers":
    "Content-Disposition, X-API-Version, X-Export-Total, X-Export-Count, X-Export-Truncated",
  "X-API-Version": PUBLIC_API_VERSION,
};

function headers(
  extra: HeadersInit = {},
): Headers {
  const result = new Headers(
    PUBLIC_API_BASE_HEADERS,
  );
  const source = new Headers(extra);

  source.forEach((value, key) => {
    result.set(key, value);
  });

  return result;
}

export function publicApiOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: headers(),
  });
}

export function publicApiRawJson(
  data: unknown,
  init: {
    status?: number;
    headers?: HeadersInit;
  } = {},
): Response {
  return Response.json(data, {
    status: init.status ?? 200,
    headers: headers(init.headers),
  });
}

export function publicApiJson<T>(
  data: T,
  init: {
    status?: number;
    headers?: HeadersInit;
  } = {},
): Response {
  const payload: ApiEnvelope<T> = {
    apiVersion: PUBLIC_API_VERSION,
    data,
  };

  return Response.json(payload, {
    status: init.status ?? 200,
    headers: headers(init.headers),
  });
}

export function publicApiError(
  status: number,
  code: string,
  message: string,
  issues?: ApiErrorDetail[],
): Response {
  return Response.json(
    {
      apiVersion: PUBLIC_API_VERSION,
      error: {
        code,
        message,
        ...(issues && issues.length > 0
          ? { issues }
          : {}),
      },
    },
    {
      status,
      headers: headers(),
    },
  );
}

function queryObject(
  searchParams: URLSearchParams,
): PublicSearchParams {
  const result: PublicSearchParams = {};

  for (const [key, value] of searchParams.entries()) {
    const existing = result[key];

    if (existing === undefined) {
      result[key] = value;
    } else if (Array.isArray(existing)) {
      result[key] = [...existing, value];
    } else {
      result[key] = [existing, value];
    }
  }

  return result;
}

function relationshipQueryObject(
  searchParams: URLSearchParams,
): RelationshipQueryParams {
  const result: RelationshipQueryParams = {};

  for (const [key, value] of searchParams.entries()) {
    const existing = result[key];

    if (existing === undefined) {
      result[key] = value;
    } else if (Array.isArray(existing)) {
      result[key] = [...existing, value];
    } else {
      result[key] = [existing, value];
    }
  }

  return result;
}

export async function handleApiRegistries(): Promise<Response> {
  const registries =
    await listPublicRegistries();

  return publicApiJson(
    registries.map((registry) =>
      publicRegistrySummary(
        registry.config,
      ),
    ),
  );
}

export async function handleApiRegistry(
  registryId: string,
): Promise<Response> {
  const registry =
    await getPublicRegistry(registryId);

  if (!registry) {
    return publicApiError(
      404,
      "registry_not_found",
      "The requested registry does not exist.",
    );
  }

  return publicApiJson(
    publicRegistryDetail(registry.config),
  );
}

async function publicSearchData(
  request: Request,
  registryId: string,
): Promise<
  | {
      ok: true;
      registry:
        NonNullable<
          Awaited<
            ReturnType<typeof getPublicRegistry>
          >
        >;
      data: ApiSearchData;
    }
  | {
      ok: false;
      response: Response;
    }
> {
  const registry =
    await getPublicRegistry(registryId);

  if (!registry) {
    return {
      ok: false,
      response: publicApiError(
        404,
        "registry_not_found",
        "The requested registry does not exist.",
      ),
    };
  }

  try {
    const url = new URL(request.url);
    const parsed = parsePublicSearchRequest(
      registry.config,
      queryObject(url.searchParams),
    );
    const result = await searchPublicRecords(
      registry.config,
      parsed,
    );

    return {
      ok: true,
      registry,
      data: {
        registry:
          publicRegistrySummary(
            registry.config,
          ),
        result,
      },
    };
  } catch (error) {
    if (
      error instanceof
      SearchValidationError
    ) {
      return {
        ok: false,
        response: publicApiError(
          400,
          "invalid_search",
          "The search request is invalid.",
          error.issues.map((issue) => ({
            path: issue.path,
            code: issue.code,
            message: issue.message,
          })),
        ),
      };
    }

    throw error;
  }
}

export async function handleApiSearch(
  request: Request,
  registryId: string,
): Promise<Response> {
  const result = await publicSearchData(
    request,
    registryId,
  );

  return result.ok
    ? publicApiJson(result.data)
    : result.response;
}

export async function handleApiRecord(
  registryId: string,
  recordId: string,
): Promise<Response> {
  const [registry, recordView] =
    await Promise.all([
      getPublicRegistry(registryId),
      getPublicRecordView(
        registryId,
        recordId,
      ),
    ]);

  if (!registry) {
    return publicApiError(
      404,
      "registry_not_found",
      "The requested registry does not exist.",
    );
  }

  if (!recordView) {
    return publicApiError(
      404,
      "record_not_found",
      "The requested public record does not exist.",
    );
  }

  return publicApiJson({
    registry:
      publicRegistrySummary(
        registry.config,
      ),
    result: recordView,
  });
}

export async function handleApiEvidence(
  registryId: string,
  recordId: string,
): Promise<Response> {
  const [registry, recordView] =
    await Promise.all([
      getPublicRegistry(registryId),
      getPublicRecordView(
        registryId,
        recordId,
      ),
    ]);

  if (!registry) {
    return publicApiError(
      404,
      "registry_not_found",
      "The requested registry does not exist.",
    );
  }

  if (!recordView) {
    return publicApiError(
      404,
      "record_not_found",
      "The requested public record does not exist.",
    );
  }

  const evidence = await getPublicEvidence(
    registry.config,
    recordView.record,
  );

  return publicApiJson({
    registry:
      publicRegistrySummary(
        registry.config,
      ),
    record: recordView.record,
    disclosure: recordView.disclosure,
    evidence,
  });
}

export async function handleApiHistory(
  registryId: string,
  recordId: string,
): Promise<Response> {
  const [registry, recordView] =
    await Promise.all([
      getPublicRegistry(registryId),
      getPublicRecordView(
        registryId,
        recordId,
      ),
    ]);

  if (!registry) {
    return publicApiError(
      404,
      "registry_not_found",
      "The requested registry does not exist.",
    );
  }

  if (!recordView) {
    return publicApiError(
      404,
      "record_not_found",
      "The requested public record does not exist.",
    );
  }

  const history = await getPublicHistory(
    registry.config,
    recordView.record,
  );

  return publicApiJson({
    registry:
      publicRegistrySummary(
        registry.config,
      ),
    record: recordView.record,
    disclosure: recordView.disclosure,
    history,
  });
}

export async function handleApiRelationships(
  request: Request,
  registryId: string,
  recordId: string,
): Promise<Response> {
  const [registry, recordView] =
    await Promise.all([
      getPublicRegistry(registryId),
      getPublicRecordView(
        registryId,
        recordId,
      ),
    ]);

  if (!registry) {
    return publicApiError(
      404,
      "registry_not_found",
      "The requested registry does not exist.",
    );
  }

  if (!recordView) {
    return publicApiError(
      404,
      "record_not_found",
      "The requested public record does not exist.",
    );
  }

  const url = new URL(request.url);
  const query =
    relationshipQueryObject(
      url.searchParams,
    );
  const requestedTypes =
    relationshipValues(query.type);
  const relationshipTypeIds =
    requestedTypes.filter((id) =>
      registry.config
        .relationshipTypesById.has(id),
    );
  const direction =
    relationshipDirectionParam(
      query.direction,
    );
  const result =
    await listPublicRelationships(
      registry.config,
      recordView.record,
      {
        relationshipTypeIds:
          relationshipTypeIds.length > 0
            ? relationshipTypeIds
            : undefined,
        direction,
        maxNodes: 201,
      },
    );

  return publicApiJson({
    registry:
      publicRegistrySummary(
        registry.config,
      ),
    record: recordView.record,
    disclosure: recordView.disclosure,
    filters: {
      relationshipTypeIds,
      direction: direction ?? null,
    },
    ...result,
  });
}

export async function handleApiGraph(
  request: Request,
  registryId: string,
  recordId: string,
): Promise<Response> {
  const [registry, recordView] =
    await Promise.all([
      getPublicRegistry(registryId),
      getPublicRecordView(
        registryId,
        recordId,
      ),
    ]);

  if (!registry) {
    return publicApiError(
      404,
      "registry_not_found",
      "The requested registry does not exist.",
    );
  }

  if (!recordView) {
    return publicApiError(
      404,
      "record_not_found",
      "The requested public record does not exist.",
    );
  }

  const url = new URL(request.url);
  const query =
    relationshipQueryObject(
      url.searchParams,
    );
  const depth =
    relationshipDepthParam(query.depth);
  const requestedTypes =
    relationshipValues(query.type);
  const relationshipTypeIds =
    requestedTypes.filter((id) =>
      registry.config
        .relationshipTypesById.has(id),
    );
  const result =
    await getPublicRelationshipGraph(
      registry.config,
      recordId,
      {
        depth,
        relationshipTypeIds:
          relationshipTypeIds.length > 0
            ? relationshipTypeIds
            : undefined,
        maxNodes: 100,
      },
    );

  if (!result) {
    return publicApiError(
      404,
      "record_not_found",
      "The requested public record does not exist.",
    );
  }

  return publicApiJson({
    registry:
      publicRegistrySummary(
        registry.config,
      ),
    record: recordView.record,
    disclosure: recordView.disclosure,
    filters: {
      depth,
      relationshipTypeIds,
    },
    ...result,
  });
}

export async function handleApiDeadlines(
  registryId: string,
  recordId: string,
): Promise<Response> {
  const [registry, recordView] =
    await Promise.all([
      getPublicRegistry(registryId),
      getPublicRecordView(
        registryId,
        recordId,
      ),
    ]);

  if (!registry) {
    return publicApiError(
      404,
      "registry_not_found",
      "The requested registry does not exist.",
    );
  }

  if (!recordView) {
    return publicApiError(
      404,
      "record_not_found",
      "The requested public record does not exist.",
    );
  }

  const deadlines =
    await getPublicDeadlines(
      registry.config,
      recordView.record,
    );

  return publicApiJson({
    registry:
      publicRegistrySummary(
        registry.config,
      ),
    record: recordView.record,
    disclosure: recordView.disclosure,
    deadlines,
  });
}

function exportFormat(
  value: string | null,
): ApiExportFormat | null {
  if (!value || value === "json") {
    return "json";
  }

  if (
    value === "ndjson" ||
    value === "csv"
  ) {
    return value;
  }

  return null;
}

function exportLimit(
  value: string | null,
): number | null {
  if (!value) return 10_000;

  const parsed = Number.parseInt(
    value,
    10,
  );

  if (
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    parsed > 10_000
  ) {
    return null;
  }

  return parsed;
}

export async function handleApiExport(
  request: Request,
  registryId: string,
): Promise<Response> {
  const registry =
    await getPublicRegistry(registryId);

  if (!registry) {
    return publicApiError(
      404,
      "registry_not_found",
      "The requested registry does not exist.",
    );
  }

  const url = new URL(request.url);
  const format = exportFormat(
    url.searchParams.get("format"),
  );
  const maxRecords = exportLimit(
    url.searchParams.get("maxRecords"),
  );

  if (!format) {
    return publicApiError(
      400,
      "invalid_export_format",
      "format must be json, ndjson, or csv.",
    );
  }

  if (maxRecords === null) {
    return publicApiError(
      400,
      "invalid_export_limit",
      "maxRecords must be an integer from 1 through 10000.",
    );
  }

  let baseRequest: SearchRequest;

  try {
    baseRequest =
      parsePublicSearchRequest(
        registry.config,
        queryObject(url.searchParams),
      );
  } catch (error) {
    if (
      error instanceof
      SearchValidationError
    ) {
      return publicApiError(
        400,
        "invalid_search",
        "The export filters are invalid.",
        error.issues.map((issue) => ({
          path: issue.path,
          code: issue.code,
          message: issue.message,
        })),
      );
    }

    throw error;
  }

  const records: RegistryRecord[] = [];
  let page = 1;
  let total = 0;

  while (records.length < maxRecords) {
    const pageResult =
      await searchPublicRecords(
        registry.config,
        {
          ...baseRequest,
          page,
          pageSize: Math.min(
            100,
            maxRecords - records.length,
          ),
        },
      );

    if (page === 1) {
      total = pageResult.total;
    }

    records.push(
      ...pageResult.hits.map(
        (hit) => hit.record,
      ),
    );

    if (
      pageResult.hits.length === 0 ||
      records.length >= total
    ) {
      break;
    }

    page += 1;
  }

  const truncated =
    records.length < total;
  const generatedAt =
    new Date().toISOString();
  const serialized =
    serializePublicRecordExport(
      registry.config,
      records,
      {
        format,
        generatedAt,
        total,
        truncated,
      },
    );
  const filename =
    `${registry.config.definition.id}-${generatedAt.slice(0, 10)}.${serialized.extension}`;

  return new Response(serialized.body, {
    status: 200,
    headers: headers({
      "Content-Type":
        serialized.contentType,
      "Content-Disposition":
        `attachment; filename="${filename}"`,
      "X-Export-Total":
        String(serialized.metadata.total),
      "X-Export-Count":
        String(
          serialized.metadata.exported,
        ),
      "X-Export-Truncated":
        String(
          serialized.metadata.truncated,
        ),
    }),
  });
}
