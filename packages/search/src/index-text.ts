import type { CompiledRegistryConfig } from "@civic-registry/config";
import type {
  FieldDefinition,
  FieldValue,
  RegistryRecord,
} from "@civic-registry/core";

function scalar(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function searchableValue(
  field: FieldDefinition,
  value: FieldValue | undefined,
): string[] {
  if (value === undefined || value === null) return [];

  if (field.type === "enum" && typeof value === "string") {
    const label = field.options?.find(
      (option) => option.value === value,
    )?.label;
    return label ? [value, label] : [value];
  }

  if (
    field.type === "multiEnum" &&
    Array.isArray(value)
  ) {
    const parts: string[] = [];

    for (const item of value) {
      const raw = scalar(item);
      if (raw) parts.push(raw);

      if (typeof item === "string") {
        const label = field.options?.find(
          (option) => option.value === item,
        )?.label;
        if (label) parts.push(label);
      }
    }

    return parts;
  }

  if (Array.isArray(value)) {
    return value.map(scalar).filter(Boolean);
  }

  return [scalar(value)].filter(Boolean);
}

export function buildRecordSearchText(
  record: RegistryRecord,
  registry: CompiledRegistryConfig,
): string {
  const recordType = registry.getRecordType(
    record.recordTypeId,
  );
  const parts = [record.id, ...(record.tags ?? [])];

  for (const field of recordType.definition.fields) {
    if (!field.searchable) continue;
    parts.push(
      ...searchableValue(field, record.fields[field.id]),
    );
  }

  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n");
}
