import type {
  CompiledRegistryConfig,
} from "@civic-registry/config";
import type {
  FieldValue,
  RegistryRecord,
} from "@civic-registry/core";

import {
  PUBLIC_API_VERSION,
  type ApiExportFormat,
  type ApiExportMetadata,
  type ApiJsonExport,
  type SerializedApiExport,
} from "./types.ts";
import {
  publicRegistrySummary,
} from "./registry.ts";

function scalarText(
  value: FieldValue | undefined,
): string {
  if (value === undefined || value === null) {
    return "";
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }

  return JSON.stringify(value);
}

function spreadsheetSafe(
  value: string,
): string {
  if (
    /^[=+\-@]/.test(value)
  ) {
    return `'${value}`;
  }

  return value;
}

function csvCell(
  value: string,
): string {
  const safe = spreadsheetSafe(value);

  if (
    safe.includes(",") ||
    safe.includes('"') ||
    safe.includes("\n") ||
    safe.includes("\r")
  ) {
    return `"${safe.replaceAll('"', '""')}"`;
  }

  return safe;
}

function exportFieldIds(
  registry: CompiledRegistryConfig,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const recordType of registry.definition.recordTypes) {
    for (const field of recordType.fields) {
      if (seen.has(field.id)) continue;
      seen.add(field.id);
      result.push(field.id);
    }
  }

  return result;
}

function serializeCsv(
  registry: CompiledRegistryConfig,
  records: RegistryRecord[],
): string {
  const fieldIds = exportFieldIds(registry);
  const columns = [
    "id",
    "recordTypeId",
    "status",
    "visibility",
    "createdAt",
    "updatedAt",
    "publishedAt",
    "tags",
    "externalIdentifiers",
    ...fieldIds.map(
      (fieldId) => `field.${fieldId}`,
    ),
  ];
  const rows = [
    columns.map(csvCell).join(","),
  ];

  for (const record of records) {
    const values = [
      record.id,
      record.recordTypeId,
      record.status,
      record.visibility,
      record.createdAt,
      record.updatedAt,
      record.publishedAt ?? "",
      JSON.stringify(record.tags ?? []),
      JSON.stringify(
        record.externalIdentifiers ?? [],
      ),
      ...fieldIds.map((fieldId) =>
        scalarText(record.fields[fieldId]),
      ),
    ];

    rows.push(
      values.map(csvCell).join(","),
    );
  }

  return rows.join("\r\n") + "\r\n";
}

export function serializePublicRecordExport(
  registry: CompiledRegistryConfig,
  records: RegistryRecord[],
  options: {
    format: ApiExportFormat;
    generatedAt: string;
    total: number;
    truncated: boolean;
  },
): SerializedApiExport {
  const metadata: ApiExportMetadata = {
    registry: publicRegistrySummary(registry),
    generatedAt: options.generatedAt,
    total: options.total,
    exported: records.length,
    truncated: options.truncated,
  };

  if (options.format === "ndjson") {
    return {
      body:
        records.length > 0
          ? records
              .map((record) =>
                JSON.stringify(record),
              )
              .join("\n") + "\n"
          : "",
      contentType:
        "application/x-ndjson; charset=utf-8",
      extension: "ndjson",
      metadata,
    };
  }

  if (options.format === "csv") {
    return {
      body: serializeCsv(
        registry,
        records,
      ),
      contentType:
        "text/csv; charset=utf-8",
      extension: "csv",
      metadata,
    };
  }

  const payload: ApiJsonExport = {
    apiVersion: PUBLIC_API_VERSION,
    ...metadata,
    records,
  };

  return {
    body: JSON.stringify(payload),
    contentType:
      "application/json; charset=utf-8",
    extension: "json",
    metadata,
  };
}
