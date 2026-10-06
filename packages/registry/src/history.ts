import type {
  AuditEvent,
  FieldValue,
  JsonFieldValue,
  RecordVersion,
  RegistryRecord,
} from "@civic-registry/core";
import type {
  CompiledRegistryConfig,
} from "@civic-registry/config";

import {
  formatFieldValue,
  presentRecordDetail,
  type PresentedRecordDetail,
} from "./presentation.ts";

export interface PresentedHistoryEvent {
  id: string;
  eventType: string;
  label: string;
  detail?: string;
  occurredAt: string;
  reason?: string;
  version?: number;
}

export interface PresentedRevisionChange {
  key: string;
  label: string;
  before?: string;
  after?: string;
}

export interface PresentedRecordRevision {
  id: string;
  version: number;
  operation: RecordVersion["operation"];
  operationLabel: string;
  createdAt: string;
  reason?: string;
  record: PresentedRecordDetail;
  changes: PresentedRevisionChange[];
  baselineNotice?: string;
}

function stringValue(
  value: JsonFieldValue | undefined,
): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(
  value: JsonFieldValue | undefined,
): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function stringArrayValue(
  value: JsonFieldValue | undefined,
): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string",
      )
    : [];
}

function fieldLabel(
  registry: CompiledRegistryConfig,
  record: RegistryRecord,
  fieldId: string,
): string {
  const currentType =
    registry.recordTypesById.get(record.recordTypeId);
  const currentField =
    currentType?.fieldsById.get(fieldId);

  if (currentField) return currentField.label;

  for (const recordType of registry.recordTypesById.values()) {
    const candidate = recordType.fieldsById.get(fieldId);
    if (candidate) return candidate.label;
  }

  return fieldId;
}

function statusLabel(
  registry: CompiledRegistryConfig,
  statusId: string | undefined,
): string | undefined {
  if (!statusId) return undefined;

  return (
    registry.publicationLifecycle?.statusesById.get(
      statusId,
    )?.label ?? statusId
  );
}

function relationshipLabel(
  registry: CompiledRegistryConfig,
  event: AuditEvent,
): string | undefined {
  const typeId = stringValue(
    event.metadata?.relationshipTypeId,
  );
  const direction = stringValue(
    event.metadata?.direction,
  );

  if (!typeId) return undefined;

  const type =
    registry.relationshipTypesById.get(typeId);

  if (!type) return typeId;

  if (type.directed === false) return type.label;

  if (direction === "inbound") {
    return type.inverseLabel ?? type.label;
  }

  return type.label;
}

function fieldListDetail(
  registry: CompiledRegistryConfig,
  record: RegistryRecord,
  event: AuditEvent,
): string | undefined {
  const fieldIds = stringArrayValue(
    event.metadata?.changedFieldIds,
  );

  if (fieldIds.length === 0) return undefined;

  const labels = fieldIds.map((fieldId) =>
    fieldLabel(registry, record, fieldId),
  );

  return labels.length === 1
    ? `Changed ${labels[0]}.`
    : `Changed ${labels.join(", ")}.`;
}

export function presentHistoryEvent(
  event: AuditEvent,
  record: RegistryRecord,
  registry: CompiledRegistryConfig,
): PresentedHistoryEvent {
  const version = numberValue(event.metadata?.version);
  const fromStatus = stringValue(
    event.metadata?.fromStatus,
  );
  const toStatus = stringValue(
    event.metadata?.toStatus,
  );
  const fromStatusLabel = statusLabel(
    registry,
    fromStatus,
  );
  const toStatusLabel = statusLabel(
    registry,
    toStatus,
  );
  const fieldId = stringValue(
    event.metadata?.fieldId,
  );
  const otherRecordId = stringValue(
    event.metadata?.otherRecordId,
  );
  const relation = relationshipLabel(registry, event);

  let label = event.eventType;
  let detail: string | undefined;

  switch (event.eventType) {
    case "record.history_initialized":
      label = "History tracking initialized";
      detail =
        "This is the first baseline captured by the history system; earlier revisions are not reconstructed.";
      break;
    case "record.created":
      label = "Record created";
      break;
    case "record.fields_changed":
      label = "Record fields changed";
      detail = fieldListDetail(
        registry,
        record,
        event,
      );
      break;
    case "record.published":
      label = "Record published";
      detail = fromStatus
        ? `Status changed from ${fromStatusLabel} to ${toStatusLabel ?? "Published"}.`
        : undefined;
      break;
    case "record.withdrawn":
      label = "Record withdrawn";
      detail = fromStatus
        ? `Status changed from ${fromStatusLabel} to ${toStatusLabel ?? "Withdrawn"}.`
        : undefined;
      break;
    case "record.status_changed":
      label = "Record status changed";
      detail =
        fromStatus || toStatus
          ? `Status changed from ${fromStatusLabel ?? "unknown"} to ${toStatusLabel ?? "unknown"}.`
          : undefined;
      break;
    case "record.visibility_changed":
      label = "Record visibility changed";
      detail = "A visibility transition was recorded.";
      break;
    case "record.metadata_changed":
      label = "Record metadata changed";
      break;
    case "record.deleted":
      label = "Record deleted";
      break;
    case "relationship.history_initialized":
      label = "Relationship baseline captured";
      detail = relation
        ? `${relation}${otherRecordId ? ` record ${otherRecordId}` : ""}.`
        : undefined;
      break;
    case "relationship.added":
      label = "Relationship added";
      detail = relation
        ? `${relation}${otherRecordId ? ` record ${otherRecordId}` : ""}.`
        : undefined;
      break;
    case "relationship.removed":
      label = "Relationship removed";
      detail = relation
        ? `${relation}${otherRecordId ? ` record ${otherRecordId}` : ""}.`
        : undefined;
      break;
    case "evidence.citation_history_initialized":
      label = "Evidence baseline captured";
      detail = fieldId
        ? `Citation supports ${fieldLabel(
            registry,
            record,
            fieldId,
          )}.`
        : "Citation supports the whole record.";
      break;
    case "evidence.citation_added":
      label = "Evidence citation added";
      detail = fieldId
        ? `Citation supports ${fieldLabel(
            registry,
            record,
            fieldId,
          )}.`
        : "Citation supports the whole record.";
      break;
    case "evidence.citation_updated":
      label = "Evidence citation updated";
      detail = fieldId
        ? `Citation for ${fieldLabel(
            registry,
            record,
            fieldId,
          )} was updated.`
        : "A whole-record citation was updated.";
      break;
    case "evidence.citation_removed":
      label = "Evidence citation removed";
      detail = fieldId
        ? `Citation for ${fieldLabel(
            registry,
            record,
            fieldId,
          )} was removed.`
        : "A whole-record citation was removed.";
      break;
    default:
      label = event.eventType
        .replaceAll(".", " ")
        .replaceAll("_", " ");
      break;
  }

  return {
    id: event.id,
    eventType: event.eventType,
    label,
    detail,
    occurredAt: event.occurredAt,
    reason: event.reason,
    version,
  };
}

function sameValue(
  left: FieldValue | undefined,
  right: FieldValue | undefined,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function fieldChanges(
  previous: RegistryRecord | undefined,
  current: RegistryRecord,
  registry: CompiledRegistryConfig,
): PresentedRevisionChange[] {
  if (!previous) return [];

  const changes: PresentedRevisionChange[] = [];
  const currentType = registry.getRecordType(
    current.recordTypeId,
  );
  const previousType =
    registry.recordTypesById.get(previous.recordTypeId);
  const fieldIds = new Set([
    ...Object.keys(previous.fields),
    ...Object.keys(current.fields),
  ]);

  for (const fieldId of fieldIds) {
    const before = previous.fields[fieldId];
    const after = current.fields[fieldId];

    if (sameValue(before, after)) continue;

    const field =
      currentType.fieldsById.get(fieldId) ??
      previousType?.fieldsById.get(fieldId);

    changes.push({
      key: `field:${fieldId}`,
      label: field?.label ?? fieldId,
      before: field
        ? formatFieldValue(field, before) || undefined
        : before === undefined
          ? undefined
          : JSON.stringify(before),
      after: field
        ? formatFieldValue(field, after) || undefined
        : after === undefined
          ? undefined
          : JSON.stringify(after),
    });
  }

  if (previous.status !== current.status) {
    changes.push({
      key: "status",
      label: "Status",
      before:
        statusLabel(registry, previous.status) ??
        previous.status,
      after:
        statusLabel(registry, current.status) ??
        current.status,
    });
  }

  if (
    previous.recordTypeId !== current.recordTypeId
  ) {
    changes.push({
      key: "recordType",
      label: "Record type",
      before:
        registry.recordTypesById.get(
          previous.recordTypeId,
        )?.definition.name ?? previous.recordTypeId,
      after: currentType.definition.name,
    });
  }

  if (
    previous.publishedAt !== current.publishedAt
  ) {
    changes.push({
      key: "publishedAt",
      label: "Published",
      before: previous.publishedAt,
      after: current.publishedAt,
    });
  }

  if (
    JSON.stringify(previous.tags ?? []) !==
    JSON.stringify(current.tags ?? [])
  ) {
    changes.push({
      key: "tags",
      label: "Tags",
      before: (previous.tags ?? []).join(", ") || undefined,
      after: (current.tags ?? []).join(", ") || undefined,
    });
  }

  if (
    JSON.stringify(previous.externalIdentifiers ?? []) !==
    JSON.stringify(current.externalIdentifiers ?? [])
  ) {
    changes.push({
      key: "externalIdentifiers",
      label: "External identifiers",
      before:
        (previous.externalIdentifiers ?? [])
          .map(
            (identifier) =>
              `${identifier.scheme}: ${identifier.value}`,
          )
          .join(", ") || undefined,
      after:
        (current.externalIdentifiers ?? [])
          .map(
            (identifier) =>
              `${identifier.scheme}: ${identifier.value}`,
          )
          .join(", ") || undefined,
    });
  }

  return changes;
}

function operationLabel(
  operation: RecordVersion["operation"],
): string {
  switch (operation) {
    case "baseline":
      return "Baseline snapshot";
    case "created":
      return "Created";
    case "updated":
      return "Updated";
    case "deleted":
      return "Deleted";
  }
}

export function presentRecordRevisions(
  versions: RecordVersion[],
  registry: CompiledRegistryConfig,
): PresentedRecordRevision[] {
  const ascending = [...versions].sort(
    (left, right) => left.version - right.version,
  );
  const previousByVersion = new Map<
    number,
    RegistryRecord | undefined
  >();

  let previous: RegistryRecord | undefined;

  for (const version of ascending) {
    previousByVersion.set(version.version, previous);
    previous = version.snapshot;
  }

  return [...versions]
    .sort((left, right) => right.version - left.version)
    .map((version) => ({
      id: version.id,
      version: version.version,
      operation: version.operation,
      operationLabel: operationLabel(version.operation),
      createdAt: version.createdAt,
      reason: version.reason,
      record: presentRecordDetail(
        version.snapshot,
        registry,
      ),
      changes: fieldChanges(
        previousByVersion.get(version.version),
        version.snapshot,
        registry,
      ),
      baselineNotice:
        version.operation === "baseline"
          ? "History tracking began with this snapshot; earlier revisions are not reconstructed."
          : undefined,
    }));
}
