import {
  VISIBILITY_LEVELS,
  validateRegistryRecord,
  type FieldDefinition,
  type FieldValue,
  type JsonFieldValue,
  type RegistryRecord,
  type Visibility,
} from "@civic-registry/core";
import type {
  CompiledRegistryConfig,
} from "@civic-registry/config";

import {
  isPathValueSpec,
} from "./profile.ts";
import type {
  CompiledRecordIngestionProfile,
  DecodedIngestionRow,
  IngestionIssue,
  IngestionValueSpec,
  MapIngestionContext,
  MapIngestionResult,
} from "./types.ts";

function getPathValue(
  row: Record<string, unknown>,
  path: string,
): unknown {
  const segments =
    path.match(/[^.[\]]+/g) ?? [];
  let current: unknown = row;

  for (const segment of segments) {
    if (
      current === null ||
      typeof current !== "object"
    ) {
      return undefined;
    }

    if (Array.isArray(current)) {
      const index = Number.parseInt(segment, 10);

      if (
        !Number.isInteger(index) ||
        index < 0
      ) {
        return undefined;
      }

      current = current[index];
      continue;
    }

    current = (
      current as Record<string, unknown>
    )[segment];
  }

  return current;
}

function resolveValue(
  row: Record<string, unknown>,
  spec: IngestionValueSpec,
  path: string,
  issues: IngestionIssue[],
): unknown {
  if (!isPathValueSpec(spec)) {
    return spec.literal;
  }

  let value = getPathValue(
    row,
    spec.path,
  );

  if (
    value === undefined ||
    value === null ||
    (
      typeof value === "string" &&
      value.length === 0
    )
  ) {
    if (spec.required) {
      issues.push({
        path,
        code: "required_source_value_missing",
        message:
          `Required source value ${spec.path} is missing.`,
      });
    }

    return undefined;
  }

  if (
    spec.trim &&
    typeof value === "string"
  ) {
    value = value.trim();
  }

  if (
    spec.split &&
    typeof value === "string"
  ) {
    value = value
      .split(spec.split)
      .map((part) =>
        spec.trim ? part.trim() : part,
      )
      .filter((part) => part.length > 0);
  }

  return value;
}

function stringValue(
  value: unknown,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }

  return undefined;
}

function listOfStrings(
  value: unknown,
): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "string") {
    return [value];
  }

  if (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean",
    )
  ) {
    return value.map(String);
  }

  return undefined;
}

function coerceBoolean(
  value: unknown,
): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }

  if (typeof value === "string") {
    const normalized =
      value.trim().toLowerCase();

    if (
      normalized === "true" ||
      normalized === "yes" ||
      normalized === "1"
    ) {
      return true;
    }

    if (
      normalized === "false" ||
      normalized === "no" ||
      normalized === "0"
    ) {
      return false;
    }
  }

  return undefined;
}

function coerceFieldValue(
  field: FieldDefinition,
  raw: unknown,
): FieldValue | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;

  switch (field.type) {
    case "text":
    case "longText":
    case "date":
    case "url":
    case "email":
    case "enum":
    case "entityRef":
      return stringValue(raw);
    case "datetime": {
      const string = stringValue(raw);

      if (!string) return undefined;

      const date = new Date(string);
      return Number.isNaN(date.valueOf())
        ? string
        : date.toISOString();
    }
    case "integer": {
      const numeric =
        typeof raw === "number"
          ? raw
          : Number(raw);

      return Number.isInteger(numeric)
        ? numeric
        : undefined;
    }
    case "decimal": {
      const numeric =
        typeof raw === "number"
          ? raw
          : Number(raw);

      return Number.isFinite(numeric)
        ? numeric
        : undefined;
    }
    case "boolean":
      return coerceBoolean(raw);
    case "multiEnum":
    case "entityRefList":
      return listOfStrings(raw);
    case "json":
      return raw as JsonFieldValue;
  }
}

function mappedDateTime(
  row: Record<string, unknown>,
  spec: IngestionValueSpec | undefined,
  path: string,
  issues: IngestionIssue[],
): string | undefined {
  if (!spec) return undefined;

  const raw = resolveValue(
    row,
    spec,
    path,
    issues,
  );
  const string = stringValue(raw);

  if (string === undefined) return undefined;

  const date = new Date(string);

  if (Number.isNaN(date.valueOf())) {
    issues.push({
      path,
      code: "invalid_mapped_datetime",
      message:
        `Mapped value for ${path} is not a valid date-time.`,
    });
    return undefined;
  }

  return date.toISOString();
}

function mappedString(
  row: Record<string, unknown>,
  spec: IngestionValueSpec,
  path: string,
  issues: IngestionIssue[],
): string | undefined {
  const raw = resolveValue(
    row,
    spec,
    path,
    issues,
  );
  const string = stringValue(raw);

  if (
    raw !== undefined &&
    string === undefined
  ) {
    issues.push({
      path,
      code: "mapped_value_not_scalar",
      message:
        `Mapped value for ${path} must be scalar.`,
    });
  }

  return string;
}

export function mapIngestionRow(
  row: DecodedIngestionRow,
  profile: CompiledRecordIngestionProfile,
  registry: CompiledRegistryConfig,
  context: MapIngestionContext,
): MapIngestionResult {
  const issues: IngestionIssue[] = [];
  const recordType =
    registry.getRecordType(
      profile.recordTypeId,
    );
  const recordId = mappedString(
    row.value,
    profile.recordId,
    "recordId",
    issues,
  )?.trim();

  if (!recordId) {
    issues.push({
      path: "recordId",
      code: "missing_record_id",
      message:
        "Mapped record id must be a non-empty scalar value.",
    });
  }

  const sourceKey =
    profile.sourceKey
      ? mappedString(
          row.value,
          profile.sourceKey,
          "sourceKey",
          issues,
        )?.trim()
      : recordId;

  if (!sourceKey) {
    issues.push({
      path: "sourceKey",
      code: "missing_source_key",
      message:
        "Mapped source key must be a non-empty scalar value.",
    });
  }

  const fields: Record<string, FieldValue> = {};

  for (const [fieldId, spec] of Object.entries(
    profile.fields,
  )) {
    const definition =
      recordType.fieldsById.get(fieldId);

    if (!definition) continue;

    const raw = resolveValue(
      row.value,
      spec,
      `fields.${fieldId}`,
      issues,
    );

    if (raw === undefined) continue;

    const value = coerceFieldValue(
      definition,
      raw,
    );

    if (value === undefined) {
      issues.push({
        path: `fields.${fieldId}`,
        code: "field_coercion_failed",
        message:
          `Source value cannot be coerced to ${definition.type}.`,
      });
      continue;
    }

    fields[fieldId] = value;
  }

  let status =
    registry.publicationLifecycle
      ?.definition.initialStatusId;

  if (profile.status) {
    status = mappedString(
      row.value,
      profile.status,
      "status",
      issues,
    )?.trim();
  }

  if (!status) {
    issues.push({
      path: "status",
      code: "missing_record_status",
      message:
        "A record status could not be resolved.",
    });
  }

  let visibility: Visibility =
    registry.definition.publicByDefault === true
      ? "public"
      : "private";

  if (profile.visibility) {
    const mapped = mappedString(
      row.value,
      profile.visibility,
      "visibility",
      issues,
    )?.trim();

    if (
      mapped &&
      VISIBILITY_LEVELS.includes(
        mapped as Visibility,
      )
    ) {
      visibility = mapped as Visibility;
    } else if (mapped) {
      issues.push({
        path: "visibility",
        code: "invalid_mapped_visibility",
        message:
          `Unsupported mapped visibility: ${mapped}.`,
      });
    }
  }

  const mappedTags = profile.tags
    ? listOfStrings(
        resolveValue(
          row.value,
          profile.tags,
          "tags",
          issues,
        ),
      )
    : undefined;

  if (
    profile.tags &&
    mappedTags === undefined
  ) {
    issues.push({
      path: "tags",
      code: "invalid_mapped_tags",
      message:
        "Mapped tags must be a scalar or array of scalar values.",
    });
  }

  const tags = [
    ...new Set(
      [
        ...profile.staticTags,
        ...(mappedTags ?? []),
      ]
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];

  const externalIdentifiers = (
    profile.externalIdentifiers ?? []
  ).flatMap((definition, index) => {
    const value = mappedString(
      row.value,
      definition.value,
      `externalIdentifiers[${index}].value`,
      issues,
    )?.trim();

    if (!value) return [];

    const url = definition.url
      ? mappedString(
          row.value,
          definition.url,
          `externalIdentifiers[${index}].url`,
          issues,
        )?.trim()
      : undefined;

    return [
      {
        scheme: definition.scheme.trim(),
        value,
        ...(url ? { url } : {}),
      },
    ];
  });

  const createdAt =
    mappedDateTime(
      row.value,
      profile.createdAt,
      "createdAt",
      issues,
    ) ?? context.now;
  const updatedAt =
    mappedDateTime(
      row.value,
      profile.updatedAt,
      "updatedAt",
      issues,
    ) ?? context.now;
  const publishedAt = mappedDateTime(
    row.value,
    profile.publishedAt,
    "publishedAt",
    issues,
  );

  if (
    !recordId ||
    !sourceKey ||
    !status ||
    issues.length > 0
  ) {
    return {
      ok: false,
      issues: issues.map((issue) => ({
        ...issue,
        index: row.index,
        line: row.line,
      })),
    };
  }

  const record: RegistryRecord = {
    id: recordId,
    registryId: registry.definition.id,
    recordTypeId: profile.recordTypeId,
    fields,
    status,
    visibility,
    tags,
    externalIdentifiers,
    createdAt,
    updatedAt,
    ...(publishedAt
      ? { publishedAt }
      : {}),
  };
  const domainIssues = validateRegistryRecord(
    record,
    registry.definition,
  ).filter(
    (issue) =>
      !(
        profile.mode === "upsert" &&
        issue.code ===
          "required_field_missing"
      ),
  );

  if (domainIssues.length > 0) {
    return {
      ok: false,
      issues: domainIssues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        path: issue.path,
        index: row.index,
        line: row.line,
      })),
    };
  }

  return {
    ok: true,
    item: {
      index: row.index,
      line: row.line,
      sourceKey,
      inputFingerprint: row.fingerprint,
      record,
    },
  };
}
