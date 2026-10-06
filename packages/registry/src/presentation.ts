import type {
  FieldDefinition,
  FieldValue,
  RegistryRecord,
} from "@civic-registry/core";
import type {
  CompiledRecordTypeConfig,
  CompiledRegistryConfig,
} from "@civic-registry/config";

export interface PresentedField {
  id: string;
  label: string;
  type: FieldDefinition["type"];
  rawValue: FieldValue | undefined;
  displayValue: string;
  empty: boolean;
}

export interface PresentedRecordSummary {
  id: string;
  registryId: string;
  recordTypeId: string;
  recordTypeName: string;
  titleFieldId: string;
  summaryFieldId?: string;
  title: string;
  summary?: string;
  status: string;
  updatedAt: string;
  fields: PresentedField[];
}

export interface PresentedRecordDetail extends PresentedRecordSummary {
  visibility: RegistryRecord["visibility"];
  createdAt: string;
  publishedAt?: string;
  tags: string[];
  externalIdentifiers: NonNullable<
    RegistryRecord["externalIdentifiers"]
  >;
}

function scalarToString(value: unknown): string {
  if (value === null || value === undefined) return "";

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (
    typeof value === "string" ||
    typeof value === "number"
  ) {
    return String(value);
  }

  return JSON.stringify(value);
}

export function formatFieldValue(
  field: FieldDefinition,
  value: FieldValue | undefined,
): string {
  if (value === undefined || value === null) return "";

  if (field.type === "enum" && typeof value === "string") {
    return (
      field.options?.find((option) => option.value === value)
        ?.label ?? value
    );
  }

  if (field.type === "multiEnum" && Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry !== "string") return scalarToString(entry);
        return (
          field.options?.find((option) => option.value === entry)
            ?.label ?? entry
        );
      })
      .join(", ");
  }

  if (
    field.type === "entityRefList" &&
    Array.isArray(value)
  ) {
    return value.map(scalarToString).join(", ");
  }

  if (Array.isArray(value)) {
    return value.map(scalarToString).join(", ");
  }

  return scalarToString(value);
}

function fieldValueAsTitle(
  record: RegistryRecord,
  recordType: CompiledRecordTypeConfig,
): string {
  const fieldId = recordType.definition.titleFieldId;
  const field = recordType.fieldsById.get(fieldId);
  const value = record.fields[fieldId];

  if (!field) return record.id;

  const formatted = formatFieldValue(field, value).trim();
  return formatted || record.id;
}

function fieldValueAsSummary(
  record: RegistryRecord,
  recordType: CompiledRecordTypeConfig,
): string | undefined {
  const fieldId = recordType.definition.summaryFieldId;

  if (!fieldId) return undefined;

  const field = recordType.fieldsById.get(fieldId);

  if (!field) return undefined;

  const formatted = formatFieldValue(
    field,
    record.fields[fieldId],
  ).trim();

  return formatted || undefined;
}

function presentFields(
  record: RegistryRecord,
  fields: ReadonlyArray<FieldDefinition>,
): PresentedField[] {
  return fields.map((field) => {
    const rawValue = record.fields[field.id];
    const displayValue = formatFieldValue(field, rawValue);

    return {
      id: field.id,
      label: field.label,
      type: field.type,
      rawValue,
      displayValue,
      empty: displayValue.trim().length === 0,
    };
  });
}

export function presentRecordSummary(
  record: RegistryRecord,
  registry: CompiledRegistryConfig,
): PresentedRecordSummary {
  const recordType = registry.getRecordType(record.recordTypeId);

  return {
    id: record.id,
    registryId: record.registryId,
    recordTypeId: record.recordTypeId,
    recordTypeName: recordType.definition.name,
    titleFieldId: recordType.definition.titleFieldId,
    summaryFieldId: recordType.definition.summaryFieldId,
    title: fieldValueAsTitle(record, recordType),
    summary: fieldValueAsSummary(record, recordType),
    status: record.status,
    updatedAt: record.updatedAt,
    fields: presentFields(record, recordType.listFields),
  };
}

export function presentRecordDetail(
  record: RegistryRecord,
  registry: CompiledRegistryConfig,
): PresentedRecordDetail {
  const recordType = registry.getRecordType(record.recordTypeId);

  return {
    ...presentRecordSummary(record, registry),
    visibility: record.visibility,
    createdAt: record.createdAt,
    publishedAt: record.publishedAt,
    tags: record.tags ?? [],
    externalIdentifiers: record.externalIdentifiers ?? [],
    fields: presentFields(record, recordType.detailFields),
  };
}
