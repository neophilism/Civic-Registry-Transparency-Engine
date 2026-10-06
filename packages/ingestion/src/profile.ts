import {
  VISIBILITY_LEVELS,
} from "@civic-registry/core";
import type {
  CompiledRegistryConfig,
} from "@civic-registry/config";
import { parse } from "yaml";

import type {
  CompiledRecordIngestionProfile,
  IngestionIssue,
  IngestionValueSpec,
  RecordIngestionProfile,
} from "./types.ts";

const PROFILE_ID_PATTERN =
  /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/;

function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function validateValueSpec(
  value: unknown,
  path: string,
): IngestionIssue[] {
  const issues: IngestionIssue[] = [];

  if (!isPlainObject(value)) {
    return [
      {
        path,
        code: "invalid_value_spec",
        message:
          "Ingestion value specifications must be objects.",
      },
    ];
  }

  const hasPath =
    typeof value.path === "string";
  const hasLiteral =
    Object.hasOwn(value, "literal");

  if (hasPath === hasLiteral) {
    issues.push({
      path,
      code: "ambiguous_value_spec",
      message:
        "A value specification must define exactly one of path or literal.",
    });
  }

  if (
    hasPath &&
    value.path.trim().length === 0
  ) {
    issues.push({
      path: `${path}.path`,
      code: "empty_source_path",
      message:
        "Source paths must be non-empty strings.",
    });
  }

  if (
    value.required !== undefined &&
    typeof value.required !== "boolean"
  ) {
    issues.push({
      path: `${path}.required`,
      code: "invalid_value_spec_boolean",
      message:
        "required must be a boolean when provided.",
    });
  }

  if (
    value.trim !== undefined &&
    typeof value.trim !== "boolean"
  ) {
    issues.push({
      path: `${path}.trim`,
      code: "invalid_value_spec_boolean",
      message:
        "trim must be a boolean when provided.",
    });
  }

  if (
    value.split !== undefined &&
    (
      typeof value.split !== "string" ||
      value.split.length === 0
    )
  ) {
    issues.push({
      path: `${path}.split`,
      code: "invalid_split_delimiter",
      message:
        "split must be a non-empty string when provided.",
    });
  }

  if (
    hasLiteral &&
    (
      value.required !== undefined ||
      value.trim !== undefined ||
      value.split !== undefined
    )
  ) {
    issues.push({
      path,
      code: "literal_value_has_path_options",
      message:
        "Literal value specifications cannot define required, trim, or split.",
    });
  }

  return issues;
}

export function validateIngestionProfile(
  profile: unknown,
  registry: CompiledRegistryConfig,
): IngestionIssue[] {
  if (!isPlainObject(profile)) {
    return [
      {
        path: "$",
        code: "invalid_ingestion_profile",
        message:
          "Ingestion profile must be an object.",
      },
    ];
  }

  const issues: IngestionIssue[] = [];
  const id = profile.id;

  if (
    typeof id !== "string" ||
    !PROFILE_ID_PATTERN.test(id)
  ) {
    issues.push({
      path: "id",
      code: "invalid_ingestion_profile_id",
      message:
        "Profile id must be a lowercase configuration identifier.",
    });
  }

  const recordTypeId = profile.recordTypeId;

  if (
    typeof recordTypeId !== "string" ||
    !registry.recordTypesById.has(recordTypeId)
  ) {
    issues.push({
      path: "recordTypeId",
      code: "unknown_ingestion_record_type",
      message:
        "recordTypeId must reference a configured record type.",
    });
  }

  if (
    profile.mode !== undefined &&
    profile.mode !== "create" &&
    profile.mode !== "upsert"
  ) {
    issues.push({
      path: "mode",
      code: "invalid_ingestion_mode",
      message:
        "mode must be create or upsert.",
    });
  }

  issues.push(
    ...validateValueSpec(
      profile.recordId,
      "recordId",
    ),
  );

  if (profile.sourceKey !== undefined) {
    issues.push(
      ...validateValueSpec(
        profile.sourceKey,
        "sourceKey",
      ),
    );
  }

  if (!isPlainObject(profile.fields)) {
    issues.push({
      path: "fields",
      code: "invalid_ingestion_fields",
      message:
        "fields must be an object keyed by target field id.",
    });
  } else if (
    typeof recordTypeId === "string" &&
    registry.recordTypesById.has(recordTypeId)
  ) {
    const recordType =
      registry.getRecordType(recordTypeId);

    for (const [fieldId, spec] of Object.entries(
      profile.fields,
    )) {
      if (!recordType.fieldsById.has(fieldId)) {
        issues.push({
          path: `fields.${fieldId}`,
          code: "unknown_ingestion_field",
          message:
            `Field ${fieldId} is not configured for record type ${recordTypeId}.`,
        });
      }

      issues.push(
        ...validateValueSpec(
          spec,
          `fields.${fieldId}`,
        ),
      );
    }
  }

  for (const key of [
    "status",
    "visibility",
    "tags",
    "createdAt",
    "updatedAt",
    "publishedAt",
  ] as const) {
    if (profile[key] !== undefined) {
      issues.push(
        ...validateValueSpec(
          profile[key],
          key,
        ),
      );
    }
  }

  if (
    profile.status === undefined &&
    !registry.publicationLifecycle
  ) {
    issues.push({
      path: "status",
      code: "missing_ingestion_status",
      message:
        "Profiles for registries without a publication lifecycle must map or provide a status.",
    });
  }

  if (
    isPlainObject(profile.status) &&
    Object.hasOwn(profile.status, "literal") &&
    typeof profile.status.literal === "string" &&
    registry.publicationLifecycle &&
    !registry.publicationLifecycle.statusesById.has(
      profile.status.literal,
    )
  ) {
    issues.push({
      path: "status.literal",
      code: "unknown_ingestion_status",
      message:
        `Status ${profile.status.literal} is not configured in the publication lifecycle.`,
    });
  }

  if (
    isPlainObject(profile.visibility) &&
    Object.hasOwn(profile.visibility, "literal") &&
    (
      typeof profile.visibility.literal !==
        "string" ||
      !VISIBILITY_LEVELS.includes(
        profile.visibility.literal as
          (typeof VISIBILITY_LEVELS)[number],
      )
    )
  ) {
    issues.push({
      path: "visibility.literal",
      code: "invalid_ingestion_visibility",
      message:
        "Literal visibility must be a supported visibility level.",
    });
  }

  if (profile.staticTags !== undefined) {
    if (
      !Array.isArray(profile.staticTags) ||
      !profile.staticTags.every(
        (tag) =>
          typeof tag === "string" &&
          tag.trim().length > 0,
      )
    ) {
      issues.push({
        path: "staticTags",
        code: "invalid_static_tags",
        message:
          "staticTags must contain non-empty strings.",
      });
    }
  }

  if (profile.externalIdentifiers !== undefined) {
    if (!Array.isArray(profile.externalIdentifiers)) {
      issues.push({
        path: "externalIdentifiers",
        code: "invalid_external_identifier_specs",
        message:
          "externalIdentifiers must be an array.",
      });
    } else {
      profile.externalIdentifiers.forEach(
        (candidate, index) => {
          const path =
            `externalIdentifiers[${index}]`;

          if (!isPlainObject(candidate)) {
            issues.push({
              path,
              code: "invalid_external_identifier_spec",
              message:
                "Each external identifier mapping must be an object.",
            });
            return;
          }

          if (
            typeof candidate.scheme !== "string" ||
            candidate.scheme.trim().length === 0
          ) {
            issues.push({
              path: `${path}.scheme`,
              code: "invalid_external_identifier_scheme",
              message:
                "External identifier schemes must be non-empty strings.",
            });
          }

          issues.push(
            ...validateValueSpec(
              candidate.value,
              `${path}.value`,
            ),
          );

          if (candidate.url !== undefined) {
            issues.push(
              ...validateValueSpec(
                candidate.url,
                `${path}.url`,
              ),
            );
          }
        },
      );
    }
  }

  for (const booleanKey of [
    "allowLifecycleBootstrap",
    "replaceFields",
  ] as const) {
    if (
      profile[booleanKey] !== undefined &&
      typeof profile[booleanKey] !== "boolean"
    ) {
      issues.push({
        path: booleanKey,
        code: "invalid_ingestion_boolean",
        message:
          `${booleanKey} must be a boolean when provided.`,
      });
    }
  }

  return issues;
}

export class IngestionProfileError extends Error {
  readonly issues: IngestionIssue[];

  constructor(
    message: string,
    issues: IngestionIssue[],
  ) {
    super(message);
    this.name = "IngestionProfileError";
    this.issues = issues;
  }
}

export function compileIngestionProfile(
  profile: RecordIngestionProfile,
  registry: CompiledRegistryConfig,
): CompiledRecordIngestionProfile {
  const issues =
    validateIngestionProfile(
      profile,
      registry,
    );

  if (issues.length > 0) {
    throw new IngestionProfileError(
      "Ingestion profile is invalid.",
      issues,
    );
  }

  return {
    ...profile,
    mode: profile.mode ?? "upsert",
    staticTags: [
      ...new Set(
        (profile.staticTags ?? [])
          .map((tag) => tag.trim())
          .filter(Boolean),
      ),
    ],
    allowLifecycleBootstrap:
      profile.allowLifecycleBootstrap === true,
    replaceFields:
      profile.replaceFields === true,
  };
}

export function parseIngestionProfile(
  source: string,
  registry: CompiledRegistryConfig,
): CompiledRecordIngestionProfile {
  let parsed: unknown;

  try {
    parsed = parse(source);
  } catch (error) {
    throw new IngestionProfileError(
      "Could not parse ingestion profile.",
      [
        {
          path: "$",
          code: "ingestion_profile_parse_error",
          message:
            error instanceof Error
              ? error.message
              : "Invalid YAML or JSON.",
        },
      ],
    );
  }

  return compileIngestionProfile(
    parsed as RecordIngestionProfile,
    registry,
  );
}

export function isPathValueSpec(
  spec: IngestionValueSpec,
): spec is Extract<
  IngestionValueSpec,
  { path: string }
> {
  return "path" in spec;
}
