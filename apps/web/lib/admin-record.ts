import type {
  CompiledRecordTypeConfig,
} from "@civic-registry/config";
import type {
  FieldDefinition,
  FieldValue,
  RegistryRecord,
} from "@civic-registry/core";

export class AdminRecordInputError extends Error {
  readonly fieldId: string;

  constructor(
    fieldId: string,
    message: string,
  ) {
    super(message);
    this.name = "AdminRecordInputError";
    this.fieldId = fieldId;
  }
}

function fieldKey(fieldId: string): string {
  return "field." + fieldId;
}

function textValue(
  formData: FormData,
  key: string,
): string {
  const value = formData.get(key);
  return typeof value === "string"
    ? value.trim()
    : "";
}

function requireFiniteNumber(
  field: FieldDefinition,
  value: string,
  integer: boolean,
): number {
  const parsed = Number(value);

  if (
    value.length === 0 ||
    !Number.isFinite(parsed) ||
    (integer && !Number.isInteger(parsed))
  ) {
    throw new AdminRecordInputError(
      field.id,
      field.label +
        " must be " +
        (integer ? "an integer." : "a number."),
    );
  }

  return parsed;
}

function parseListText(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseField(
  field: FieldDefinition,
  formData: FormData,
): FieldValue | undefined {
  const key = fieldKey(field.id);

  if (field.type === "boolean") {
    return formData.get(key) !== null;
  }

  if (field.type === "multiEnum") {
    const values = formData
      .getAll(key)
      .filter(
        (value): value is string =>
          typeof value === "string",
      )
      .map((value) => value.trim())
      .filter(Boolean);

    return values.length > 0 ? values : undefined;
  }

  const raw = textValue(formData, key);

  if (raw.length === 0) return undefined;

  switch (field.type) {
    case "integer":
      return requireFiniteNumber(field, raw, true);
    case "decimal":
      return requireFiniteNumber(field, raw, false);
    case "entityRefList":
      return parseListText(raw);
    case "json":
      try {
        return JSON.parse(raw) as FieldValue;
      } catch {
        throw new AdminRecordInputError(
          field.id,
          field.label + " must contain valid JSON.",
        );
      }
    default:
      return raw;
  }
}

export function parseAdminRecordFields(
  recordType: CompiledRecordTypeConfig,
  formData: FormData,
): Record<string, FieldValue> {
  const fields: Record<string, FieldValue> = {};

  for (const field of recordType.definition.fields) {
    const value = parseField(field, formData);

    if (value !== undefined) {
      fields[field.id] = value;
    }
  }

  return fields;
}

export function stringifyAdminFieldValue(
  field: FieldDefinition,
  value: FieldValue | undefined,
): string | string[] {
  if (value === undefined || value === null) {
    return field.type === "multiEnum" ? [] : "";
  }

  if (
    field.type === "multiEnum" &&
    Array.isArray(value)
  ) {
    return value.map(String);
  }

  if (
    field.type === "entityRefList" &&
    Array.isArray(value)
  ) {
    return value.map(String).join("\n");
  }

  if (field.type === "json") {
    return JSON.stringify(value, null, 2);
  }

  return String(value);
}

export function adminRecordTitle(
  recordType: CompiledRecordTypeConfig,
  record: RegistryRecord,
): string {
  const value =
    record.fields[
      recordType.definition.titleFieldId
    ];

  return typeof value === "string" &&
    value.trim().length > 0
    ? value
    : record.id;
}
