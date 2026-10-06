import {
  ACTOR_KINDS,
  FIELD_TYPES,
  VISIBILITY_LEVELS,
  type FieldDefinition,
  type FieldValue,
  type RegistryDefinition,
  type RegistryRecord,
  type RecordTypeDefinition,
} from "./domain.ts";

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

export class DomainValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(message: string, issues: ValidationIssue[]) {
    super(message);
    this.name = "DomainValidationError";
    this.issues = issues;
  }
}

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  );
}

function isIsoDateTime(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isEmail(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}

function addRequiredStringIssue(
  issues: ValidationIssue[],
  path: string,
  value: unknown,
) {
  if (!isNonEmptyString(value)) {
    issues.push({
      path,
      code: "required_string",
      message: "Must be a non-empty string.",
    });
  }
}

function addIdentifierIssue(
  issues: ValidationIssue[],
  path: string,
  value: unknown,
) {
  addRequiredStringIssue(issues, path, value);

  if (isNonEmptyString(value) && !IDENTIFIER_PATTERN.test(value)) {
    issues.push({
      path,
      code: "invalid_identifier",
      message:
        "Must start with a lowercase letter and contain only lowercase letters, numbers, hyphens, or underscores.",
    });
  }
}

function validateFieldDefinition(
  field: FieldDefinition,
  recordTypePath: string,
  knownRecordTypeIds: Set<string>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const path = `${recordTypePath}.fields[${field.id || "?"}]`;

  addIdentifierIssue(issues, `${path}.id`, field.id);
  addRequiredStringIssue(issues, `${path}.label`, field.label);

  if (!FIELD_TYPES.includes(field.type)) {
    issues.push({
      path: `${path}.type`,
      code: "invalid_field_type",
      message: `Unsupported field type: ${String(field.type)}.`,
    });
  }

  if (field.type === "enum" || field.type === "multiEnum") {
    if (!field.options || field.options.length === 0) {
      issues.push({
        path: `${path}.options`,
        code: "missing_enum_options",
        message: "Enum fields must define at least one option.",
      });
    } else {
      const values = new Set<string>();

      field.options.forEach((option, index) => {
        const optionPath = `${path}.options[${index}]`;
        addRequiredStringIssue(issues, `${optionPath}.value`, option.value);
        addRequiredStringIssue(issues, `${optionPath}.label`, option.label);

        if (values.has(option.value)) {
          issues.push({
            path: `${optionPath}.value`,
            code: "duplicate_enum_value",
            message: `Duplicate enum value: ${option.value}.`,
          });
        }

        values.add(option.value);
      });
    }
  } else if (field.options && field.options.length > 0) {
    issues.push({
      path: `${path}.options`,
      code: "unexpected_options",
      message: "Only enum and multiEnum fields may define options.",
    });
  }

  if (field.type === "entityRef" || field.type === "entityRefList") {
    if (!field.targetRecordTypeIds || field.targetRecordTypeIds.length === 0) {
      issues.push({
        path: `${path}.targetRecordTypeIds`,
        code: "missing_reference_targets",
        message: "Entity reference fields must define at least one target record type.",
      });
    } else {
      for (const target of field.targetRecordTypeIds) {
        if (!knownRecordTypeIds.has(target)) {
          issues.push({
            path: `${path}.targetRecordTypeIds`,
            code: "unknown_record_type_reference",
            message: `Unknown target record type: ${target}.`,
          });
        }
      }
    }
  } else if (
    field.targetRecordTypeIds &&
    field.targetRecordTypeIds.length > 0
  ) {
    issues.push({
      path: `${path}.targetRecordTypeIds`,
      code: "unexpected_reference_targets",
      message: "Only entity reference fields may define target record types.",
    });
  }

  return issues;
}

function validateRecordType(
  recordType: RecordTypeDefinition,
  registryPath: string,
  knownRecordTypeIds: Set<string>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const path = `${registryPath}.recordTypes[${recordType.id || "?"}]`;

  addIdentifierIssue(issues, `${path}.id`, recordType.id);
  addRequiredStringIssue(issues, `${path}.name`, recordType.name);
  addRequiredStringIssue(issues, `${path}.pluralName`, recordType.pluralName);

  const fieldIds = new Set<string>();

  for (const field of recordType.fields) {
    if (fieldIds.has(field.id)) {
      issues.push({
        path: `${path}.fields`,
        code: "duplicate_field_id",
        message: `Duplicate field id: ${field.id}.`,
      });
    }

    fieldIds.add(field.id);
    issues.push(...validateFieldDefinition(field, path, knownRecordTypeIds));
  }

  if (!fieldIds.has(recordType.titleFieldId)) {
    issues.push({
      path: `${path}.titleFieldId`,
      code: "unknown_title_field",
      message: `Title field ${recordType.titleFieldId} does not exist.`,
    });
  }

  if (
    recordType.summaryFieldId &&
    !fieldIds.has(recordType.summaryFieldId)
  ) {
    issues.push({
      path: `${path}.summaryFieldId`,
      code: "unknown_summary_field",
      message: `Summary field ${recordType.summaryFieldId} does not exist.`,
    });
  }

  return issues;
}

export function validateRegistryDefinition(
  registry: RegistryDefinition,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const path = "registry";

  addIdentifierIssue(issues, `${path}.id`, registry.id);
  addRequiredStringIssue(issues, `${path}.name`, registry.name);

  if (registry.recordTypes.length === 0) {
    issues.push({
      path: `${path}.recordTypes`,
      code: "missing_record_types",
      message: "A registry must define at least one record type.",
    });

    return issues;
  }

  const recordTypeIds = new Set<string>();

  for (const recordType of registry.recordTypes) {
    if (recordTypeIds.has(recordType.id)) {
      issues.push({
        path: `${path}.recordTypes`,
        code: "duplicate_record_type_id",
        message: `Duplicate record type id: ${recordType.id}.`,
      });
    }

    recordTypeIds.add(recordType.id);
  }

  for (const recordType of registry.recordTypes) {
    issues.push(...validateRecordType(recordType, path, recordTypeIds));
  }

  if (
    registry.defaultRecordTypeId &&
    !recordTypeIds.has(registry.defaultRecordTypeId)
  ) {
    issues.push({
      path: `${path}.defaultRecordTypeId`,
      code: "unknown_default_record_type",
      message: `Unknown default record type: ${registry.defaultRecordTypeId}.`,
    });
  }

  const relationshipTypeIds = new Set<string>();

  for (const relationshipType of registry.relationshipTypes ?? []) {
    const relationshipPath =
      `${path}.relationshipTypes[${relationshipType.id || "?"}]`;

    addIdentifierIssue(
      issues,
      `${relationshipPath}.id`,
      relationshipType.id,
    );
    addRequiredStringIssue(
      issues,
      `${relationshipPath}.label`,
      relationshipType.label,
    );

    if (relationshipTypeIds.has(relationshipType.id)) {
      issues.push({
        path: `${path}.relationshipTypes`,
        code: "duplicate_relationship_type_id",
        message: `Duplicate relationship type id: ${relationshipType.id}.`,
      });
    }

    relationshipTypeIds.add(relationshipType.id);

    for (const target of [
      ...(relationshipType.fromRecordTypeIds ?? []),
      ...(relationshipType.toRecordTypeIds ?? []),
    ]) {
      if (!recordTypeIds.has(target)) {
        issues.push({
          path: relationshipPath,
          code: "unknown_relationship_record_type",
          message: `Relationship references unknown record type: ${target}.`,
        });
      }
    }
  }

  return issues;
}

function isValueValidForField(
  field: FieldDefinition,
  value: FieldValue,
): boolean {
  if (value === null) return !field.required;

  switch (field.type) {
    case "text":
    case "longText":
      return typeof value === "string";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "decimal":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "date":
      return isIsoDate(value);
    case "datetime":
      return isIsoDateTime(value);
    case "url":
      return isUrl(value);
    case "email":
      return isEmail(value);
    case "enum":
      return (
        typeof value === "string" &&
        Boolean(field.options?.some((option) => option.value === value))
      );
    case "multiEnum":
      return (
        Array.isArray(value) &&
        value.every(
          (entry) =>
            typeof entry === "string" &&
            Boolean(field.options?.some((option) => option.value === entry)),
        )
      );
    case "entityRef":
      return typeof value === "string" && value.length > 0;
    case "entityRefList":
      return (
        Array.isArray(value) &&
        value.every((entry) => typeof entry === "string" && entry.length > 0)
      );
    case "json":
      return true;
    default:
      return false;
  }
}

export function validateRegistryRecord(
  record: RegistryRecord,
  registry: RegistryDefinition,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const path = "record";

  addRequiredStringIssue(issues, `${path}.id`, record.id);

  if (record.registryId !== registry.id) {
    issues.push({
      path: `${path}.registryId`,
      code: "registry_mismatch",
      message: `Record registryId must equal ${registry.id}.`,
    });
  }

  if (!VISIBILITY_LEVELS.includes(record.visibility)) {
    issues.push({
      path: `${path}.visibility`,
      code: "invalid_visibility",
      message: `Unsupported visibility: ${String(record.visibility)}.`,
    });
  }

  if (!isIsoDateTime(record.createdAt)) {
    issues.push({
      path: `${path}.createdAt`,
      code: "invalid_datetime",
      message: "createdAt must be an ISO-compatible date-time.",
    });
  }

  if (!isIsoDateTime(record.updatedAt)) {
    issues.push({
      path: `${path}.updatedAt`,
      code: "invalid_datetime",
      message: "updatedAt must be an ISO-compatible date-time.",
    });
  }

  if (record.publishedAt && !isIsoDateTime(record.publishedAt)) {
    issues.push({
      path: `${path}.publishedAt`,
      code: "invalid_datetime",
      message: "publishedAt must be an ISO-compatible date-time.",
    });
  }

  const recordType = registry.recordTypes.find(
    (candidate) => candidate.id === record.recordTypeId,
  );

  if (!recordType) {
    issues.push({
      path: `${path}.recordTypeId`,
      code: "unknown_record_type",
      message: `Unknown record type: ${record.recordTypeId}.`,
    });

    return issues;
  }

  const fieldDefinitions = new Map(
    recordType.fields.map((field) => [field.id, field]),
  );

  for (const field of recordType.fields) {
    const value = record.fields[field.id];

    if (
      field.required &&
      (value === undefined ||
        value === null ||
        (typeof value === "string" && value.trim().length === 0))
    ) {
      issues.push({
        path: `${path}.fields.${field.id}`,
        code: "required_field_missing",
        message: `Required field ${field.id} is missing.`,
      });
    }
  }

  for (const [fieldId, value] of Object.entries(record.fields)) {
    const definition = fieldDefinitions.get(fieldId);

    if (!definition) {
      issues.push({
        path: `${path}.fields.${fieldId}`,
        code: "unknown_field",
        message: `Field ${fieldId} is not defined for record type ${recordType.id}.`,
      });
      continue;
    }

    if (!isValueValidForField(definition, value)) {
      issues.push({
        path: `${path}.fields.${fieldId}`,
        code: "invalid_field_value",
        message: `Value does not satisfy field type ${definition.type}.`,
      });
    }
  }

  return issues;
}

export function assertValidRegistryDefinition(
  registry: RegistryDefinition,
): void {
  const issues = validateRegistryDefinition(registry);

  if (issues.length > 0) {
    throw new DomainValidationError(
      "Registry definition is invalid.",
      issues,
    );
  }
}

export function assertValidRegistryRecord(
  record: RegistryRecord,
  registry: RegistryDefinition,
): void {
  const definitionIssues = validateRegistryDefinition(registry);

  if (definitionIssues.length > 0) {
    throw new DomainValidationError(
      "Cannot validate a record against an invalid registry definition.",
      definitionIssues,
    );
  }

  const issues = validateRegistryRecord(record, registry);

  if (issues.length > 0) {
    throw new DomainValidationError("Registry record is invalid.", issues);
  }
}

export function isSupportedActorKind(value: string): boolean {
  return ACTOR_KINDS.includes(value as (typeof ACTOR_KINDS)[number]);
}
