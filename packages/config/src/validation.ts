import {
  validateRegistryDefinition,
  type FieldDefinition,
  type RegistryDefinition,
} from "@civic-registry/core";

import {
  REGISTRY_CONFIG_SCHEMA_VERSION,
  type RegistryConfigFile,
  type RegistryPresentationConfig,
} from "./types.ts";

export interface ConfigValidationIssue {
  path: string;
  code: string;
  message: string;
}

export class RegistryConfigError extends Error {
  readonly issues: ConfigValidationIssue[];

  constructor(message: string, issues: ConfigValidationIssue[]) {
    super(message);
    this.name = "RegistryConfigError";
    this.issues = issues;
  }
}

function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function safeValidateRegistry(
  candidate: unknown,
): ConfigValidationIssue[] {
  if (!isPlainObject(candidate)) {
    return [
      {
        path: "registry",
        code: "invalid_registry",
        message: "registry must be an object.",
      },
    ];
  }

  if (!Array.isArray(candidate.recordTypes)) {
    return [
      {
        path: "registry.recordTypes",
        code: "invalid_record_types",
        message: "registry.recordTypes must be an array.",
      },
    ];
  }

  for (let index = 0; index < candidate.recordTypes.length; index += 1) {
    const recordType = candidate.recordTypes[index];

    if (!isPlainObject(recordType)) {
      return [
        {
          path: `registry.recordTypes[${index}]`,
          code: "invalid_record_type",
          message: "Each record type must be an object.",
        },
      ];
    }

    if (!Array.isArray(recordType.fields)) {
      return [
        {
          path: `registry.recordTypes[${index}].fields`,
          code: "invalid_fields",
          message: "Each record type must define a fields array.",
        },
      ];
    }
  }

  try {
    return validateRegistryDefinition(
      candidate as unknown as RegistryDefinition,
    );
  } catch (error) {
    return [
      {
        path: "registry",
        code: "invalid_registry_shape",
        message:
          error instanceof Error
            ? error.message
            : "Registry definition has an invalid shape.",
      },
    ];
  }
}

function validateFieldList(
  issues: ConfigValidationIssue[],
  path: string,
  fieldIds: unknown,
  fieldsById: Map<string, FieldDefinition>,
) {
  if (fieldIds === undefined) return;

  if (!Array.isArray(fieldIds) || !fieldIds.every((id) => typeof id === "string")) {
    issues.push({
      path,
      code: "invalid_field_list",
      message: "Must be an array of field identifiers.",
    });
    return;
  }

  const seen = new Set<string>();

  for (const fieldId of fieldIds) {
    if (seen.has(fieldId)) {
      issues.push({
        path,
        code: "duplicate_presentation_field",
        message: `Field ${fieldId} is listed more than once.`,
      });
    }

    seen.add(fieldId);

    if (!fieldsById.has(fieldId)) {
      issues.push({
        path,
        code: "unknown_presentation_field",
        message: `Unknown field: ${fieldId}.`,
      });
    }
  }
}

function validatePresentation(
  presentation: unknown,
  registry: RegistryDefinition,
): ConfigValidationIssue[] {
  const issues: ConfigValidationIssue[] = [];

  if (presentation === undefined) return issues;

  if (!isPlainObject(presentation)) {
    return [
      {
        path: "presentation",
        code: "invalid_presentation",
        message: "presentation must be an object.",
      },
    ];
  }

  const recordTypePresentation = presentation.recordTypes;

  if (recordTypePresentation === undefined) return issues;

  if (!isPlainObject(recordTypePresentation)) {
    return [
      {
        path: "presentation.recordTypes",
        code: "invalid_record_type_presentation",
        message: "presentation.recordTypes must be an object keyed by record type id.",
      },
    ];
  }

  const recordTypesById = new Map(
    registry.recordTypes.map((recordType) => [recordType.id, recordType]),
  );

  for (const [recordTypeId, config] of Object.entries(recordTypePresentation)) {
    const recordType = recordTypesById.get(recordTypeId);
    const basePath = `presentation.recordTypes.${recordTypeId}`;

    if (!recordType) {
      issues.push({
        path: basePath,
        code: "unknown_presentation_record_type",
        message: `Unknown record type: ${recordTypeId}.`,
      });
      continue;
    }

    if (!isPlainObject(config)) {
      issues.push({
        path: basePath,
        code: "invalid_presentation_record_type",
        message: "Record type presentation must be an object.",
      });
      continue;
    }

    const fieldsById = new Map(
      recordType.fields.map((field) => [field.id, field]),
    );

    validateFieldList(
      issues,
      `${basePath}.listFields`,
      config.listFields,
      fieldsById,
    );
    validateFieldList(
      issues,
      `${basePath}.detailFields`,
      config.detailFields,
      fieldsById,
    );

    if (config.defaultSort !== undefined) {
      if (!isPlainObject(config.defaultSort)) {
        issues.push({
          path: `${basePath}.defaultSort`,
          code: "invalid_default_sort",
          message: "defaultSort must be an object.",
        });
      } else {
        const fieldId = config.defaultSort.fieldId;
        const direction = config.defaultSort.direction;

        if (typeof fieldId !== "string" || !fieldsById.has(fieldId)) {
          issues.push({
            path: `${basePath}.defaultSort.fieldId`,
            code: "unknown_sort_field",
            message: "defaultSort.fieldId must reference a field on this record type.",
          });
        } else if (!fieldsById.get(fieldId)?.sortable) {
          issues.push({
            path: `${basePath}.defaultSort.fieldId`,
            code: "unsortable_default_field",
            message: `Field ${fieldId} must set sortable: true before it can be the default sort field.`,
          });
        }

        if (
          direction !== undefined &&
          direction !== "asc" &&
          direction !== "desc"
        ) {
          issues.push({
            path: `${basePath}.defaultSort.direction`,
            code: "invalid_sort_direction",
            message: "Sort direction must be asc or desc.",
          });
        }
      }
    }
  }

  return issues;
}

export function validateRegistryConfig(
  value: unknown,
): ConfigValidationIssue[] {
  if (!isPlainObject(value)) {
    return [
      {
        path: "$",
        code: "invalid_config",
        message: "Configuration must be an object.",
      },
    ];
  }

  const issues: ConfigValidationIssue[] = [];

  if (value.schemaVersion !== REGISTRY_CONFIG_SCHEMA_VERSION) {
    issues.push({
      path: "schemaVersion",
      code: "unsupported_schema_version",
      message: `schemaVersion must be ${REGISTRY_CONFIG_SCHEMA_VERSION}.`,
    });
  }

  const registryIssues = safeValidateRegistry(value.registry);
  issues.push(...registryIssues);

  if (registryIssues.length === 0) {
    issues.push(
      ...validatePresentation(
        value.presentation,
        value.registry as RegistryDefinition,
      ),
    );
  }

  return issues;
}

export function assertValidRegistryConfig(
  value: unknown,
): asserts value is RegistryConfigFile {
  const issues = validateRegistryConfig(value);

  if (issues.length > 0) {
    throw new RegistryConfigError(
      "Registry configuration is invalid.",
      issues,
    );
  }
}

export function getPresentationConfig(
  value: RegistryConfigFile,
): RegistryPresentationConfig {
  return value.presentation ?? {};
}
