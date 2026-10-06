import type {
  CompiledRecordTypeConfig,
  CompiledRegistryConfig,
} from "@civic-registry/config";
import type { FieldDefinition } from "@civic-registry/core";

import type {
  NormalizedSearchRequest,
  SearchRangeFilter,
  SearchRequest,
} from "./types.ts";

export interface SearchValidationIssue {
  path: string;
  code: string;
  message: string;
}

export class SearchValidationError extends Error {
  readonly issues: SearchValidationIssue[];

  constructor(issues: SearchValidationIssue[]) {
    super("Search request is invalid.");
    this.name = "SearchValidationError";
    this.issues = issues;
  }
}

const RANGE_FIELD_TYPES = new Set([
  "date",
  "datetime",
  "integer",
  "decimal",
]);

function unique(values: string[] | undefined): string[] {
  return [
    ...new Set(
      (values ?? [])
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

function getSelectedRecordType(
  registry: CompiledRegistryConfig,
  request: SearchRequest,
  issues: SearchValidationIssue[],
): CompiledRecordTypeConfig | undefined {
  if (!request.recordTypeId) return undefined;

  const recordType = registry.recordTypesById.get(
    request.recordTypeId,
  );

  if (!recordType) {
    issues.push({
      path: "recordTypeId",
      code: "unknown_record_type",
      message: `Unknown record type: ${request.recordTypeId}.`,
    });
  }

  return recordType;
}

function requireSelectedField(
  recordType: CompiledRecordTypeConfig | undefined,
  fieldId: string,
  path: string,
  issues: SearchValidationIssue[],
): FieldDefinition | undefined {
  if (!recordType) {
    issues.push({
      path,
      code: "record_type_required",
      message:
        "Configured field filters and field sorting require recordTypeId.",
    });
    return undefined;
  }

  const field = recordType.fieldsById.get(fieldId);

  if (!field) {
    issues.push({
      path,
      code: "unknown_field",
      message: `Unknown field: ${fieldId}.`,
    });
  }

  return field;
}

function normalizeRange(
  range: SearchRangeFilter,
): SearchRangeFilter {
  return {
    fieldId: range.fieldId,
    from: range.from?.trim() || undefined,
    to: range.to?.trim() || undefined,
  };
}

export function normalizeSearchRequest(
  registry: CompiledRegistryConfig,
  request: SearchRequest,
): NormalizedSearchRequest {
  const issues: SearchValidationIssue[] = [];

  if (request.registryId !== registry.definition.id) {
    issues.push({
      path: "registryId",
      code: "registry_mismatch",
      message: `Expected registryId ${registry.definition.id}.`,
    });
  }

  if (
    request.projection !== undefined &&
    request.projection !== "internal" &&
    request.projection !== "public"
  ) {
    issues.push({
      path: "projection",
      code: "invalid_search_projection",
      message:
        "projection must be internal or public.",
    });
  }

  const recordType = getSelectedRecordType(
    registry,
    request,
    issues,
  );

  const fieldFilters = (request.fieldFilters ?? [])
    .map((filter) => ({
      fieldId: filter.fieldId,
      values: unique(filter.values),
    }))
    .filter((filter) => filter.values.length > 0);

  for (const [index, filter] of fieldFilters.entries()) {
    const field = requireSelectedField(
      recordType,
      filter.fieldId,
      `fieldFilters[${index}].fieldId`,
      issues,
    );

    if (field && !field.filterable) {
      issues.push({
        path: `fieldFilters[${index}].fieldId`,
        code: "field_not_filterable",
        message: `Field ${field.id} is not configured as filterable.`,
      });
    }
  }

  const rangeFilters = (request.rangeFilters ?? [])
    .map(normalizeRange)
    .filter((range) => range.from || range.to);

  for (const [index, range] of rangeFilters.entries()) {
    const field = requireSelectedField(
      recordType,
      range.fieldId,
      `rangeFilters[${index}].fieldId`,
      issues,
    );

    if (field && !field.filterable) {
      issues.push({
        path: `rangeFilters[${index}].fieldId`,
        code: "field_not_filterable",
        message: `Field ${field.id} is not configured as filterable.`,
      });
    }

    if (field && !RANGE_FIELD_TYPES.has(field.type)) {
      issues.push({
        path: `rangeFilters[${index}].fieldId`,
        code: "field_not_range_filterable",
        message: `Field ${field.id} does not support range filtering.`,
      });
    }
  }

  if (request.sort?.by === "field") {
    if (!request.sort.fieldId) {
      issues.push({
        path: "sort.fieldId",
        code: "sort_field_required",
        message: "Field sorting requires fieldId.",
      });
    } else {
      const field = requireSelectedField(
        recordType,
        request.sort.fieldId,
        "sort.fieldId",
        issues,
      );

      if (field && !field.sortable) {
        issues.push({
          path: "sort.fieldId",
          code: "field_not_sortable",
          message: `Field ${field.id} is not configured as sortable.`,
        });
      }
    }
  }

  if (
    request.sort?.by === "relevance" &&
    !request.text?.trim()
  ) {
    issues.push({
      path: "sort.by",
      code: "relevance_requires_text",
      message: "Relevance sorting requires a text query.",
    });
  }

  const page = Math.max(1, Math.trunc(request.page ?? 1));
  const pageSize = Math.max(
    1,
    Math.min(100, Math.trunc(request.pageSize ?? 25)),
  );

  if (issues.length > 0) {
    throw new SearchValidationError(issues);
  }

  return {
    registryId: request.registryId,
    text: request.text?.trim() || undefined,
    recordTypeId: request.recordTypeId,
    statuses: unique(request.statuses),
    tags: unique(request.tags),
    fieldFilters,
    rangeFilters,
    sort: request.sort,
    page,
    pageSize,
    visibility: request.visibility,
    projection: request.projection ?? "internal",
  };
}

export function rangeFilterFieldTypes(): ReadonlySet<string> {
  return RANGE_FIELD_TYPES;
}
