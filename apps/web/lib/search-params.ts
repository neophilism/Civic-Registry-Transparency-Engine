import type { CompiledRegistryConfig } from "@civic-registry/config";
import type {
  SearchRequest,
  SearchSort,
} from "@civic-registry/search";

export type PublicSearchParams = Record<
  string,
  string | string[] | undefined
>;

export function firstSearchValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function searchValues(
  value: string | string[] | undefined,
): string[] {
  const values = Array.isArray(value)
    ? value
    : value
      ? [value]
      : [];

  return values
    .flatMap((item) => item.split(","))
    .map((item) => item.trim())
    .filter(Boolean);
}

function positiveInteger(
  value: string | undefined,
): number | undefined {
  if (!value) return undefined;

  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0
    ? number
    : undefined;
}

function parseSort(
  value: string | undefined,
  direction: string | undefined,
): SearchSort | undefined {
  if (!value) return undefined;

  const normalizedDirection =
    direction === "asc" || direction === "desc"
      ? direction
      : undefined;

  if (
    value === "relevance" ||
    value === "updated" ||
    value === "published"
  ) {
    return {
      by: value,
      direction: normalizedDirection,
    };
  }

  if (value.startsWith("field:")) {
    const fieldId = value.slice("field:".length);

    if (fieldId) {
      return {
        by: "field",
        fieldId,
        direction: normalizedDirection,
      };
    }
  }

  return undefined;
}

function isRangeField(type: string): boolean {
  return (
    type === "date" ||
    type === "datetime" ||
    type === "integer" ||
    type === "decimal"
  );
}

export function parsePublicSearchRequest(
  registry: CompiledRegistryConfig,
  params: PublicSearchParams,
  fixedRecordTypeId?: string,
): SearchRequest {
  const recordTypeId =
    fixedRecordTypeId ??
    firstSearchValue(params.type);
  const recordType = recordTypeId
    ? registry.recordTypesById.get(recordTypeId)
    : undefined;
  const fieldFilters: SearchRequest["fieldFilters"] = [];
  const rangeFilters: SearchRequest["rangeFilters"] = [];

  if (recordType) {
    for (const field of recordType.definition.fields) {
      if (!field.filterable) continue;

      if (isRangeField(field.type)) {
        const from = firstSearchValue(
          params[`from_${field.id}`],
        );
        const to = firstSearchValue(
          params[`to_${field.id}`],
        );

        if (from || to) {
          rangeFilters.push({
            fieldId: field.id,
            from,
            to,
          });
        }
        continue;
      }

      const values = searchValues(
        params[`f_${field.id}`],
      );

      if (values.length > 0) {
        fieldFilters.push({
          fieldId: field.id,
          values,
        });
      }
    }
  }

  return {
    registryId: registry.definition.id,
    recordTypeId,
    text: firstSearchValue(params.q),
    statuses: searchValues(params.status),
    tags: searchValues(params.tag),
    fieldFilters,
    rangeFilters,
    sort: parseSort(
      firstSearchValue(params.sort),
      firstSearchValue(params.order),
    ),
    page: positiveInteger(
      firstSearchValue(params.page),
    ),
    pageSize: positiveInteger(
      firstSearchValue(params.pageSize),
    ),
    visibility: "public",
  };
}

export function toUrlSearchParams(
  params: PublicSearchParams,
  overrides: Record<string, string | number | undefined> = {},
): URLSearchParams {
  const result = new URLSearchParams();

  for (const [key, raw] of Object.entries(params)) {
    const values = Array.isArray(raw)
      ? raw
      : raw !== undefined
        ? [raw]
        : [];

    for (const value of values) {
      result.append(key, value);
    }
  }

  for (const [key, value] of Object.entries(overrides)) {
    result.delete(key);

    if (value !== undefined && String(value).length > 0) {
      result.set(key, String(value));
    }
  }

  return result;
}
