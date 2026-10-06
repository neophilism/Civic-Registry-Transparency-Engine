import type {
  FieldDefinition,
  RecordTypeDefinition,
} from "@civic-registry/core";

import {
  assertValidRegistryConfig,
  getPresentationConfig,
} from "./validation.ts";
import type {
  CompiledDisclosureConfig,
  CompiledPublicationLifecycleConfig,
  CompiledRecordTypeConfig,
  CompiledRegistryConfig,
  DisclosureConfig,
  FormControlType,
  FormFieldConfig,
  PublicationLifecycleConfig,
  RecordTypePresentationConfig,
  RegistryConfigFile,
} from "./types.ts";

function getFormControl(field: FieldDefinition): FormControlType {
  switch (field.type) {
    case "text":
      return "text";
    case "longText":
      return "textarea";
    case "integer":
    case "decimal":
      return "number";
    case "boolean":
      return "checkbox";
    case "date":
      return "date";
    case "datetime":
      return "datetime";
    case "url":
      return "url";
    case "email":
      return "email";
    case "enum":
      return "select";
    case "multiEnum":
      return "multiSelect";
    case "entityRef":
      return "entitySelect";
    case "entityRefList":
      return "entityMultiSelect";
    case "json":
      return "json";
  }
}

function compileFormField(field: FieldDefinition): FormFieldConfig {
  return {
    id: field.id,
    label: field.label,
    description: field.description,
    required: field.required ?? false,
    control: getFormControl(field),
    options: field.options?.map(({ value, label }) => ({ value, label })),
    targetRecordTypeIds: field.targetRecordTypeIds,
  };
}

function resolveFields(
  recordType: RecordTypeDefinition,
  fieldIds: string[] | undefined,
  fallback: FieldDefinition[],
): FieldDefinition[] {
  if (!fieldIds) return fallback;

  const fieldsById = new Map(
    recordType.fields.map((field) => [field.id, field]),
  );

  return fieldIds.map((fieldId) => fieldsById.get(fieldId)!);
}

function defaultListFields(
  recordType: RecordTypeDefinition,
): FieldDefinition[] {
  const ids = [
    recordType.titleFieldId,
    recordType.summaryFieldId,
  ].filter((value): value is string => Boolean(value));

  const uniqueIds = [...new Set(ids)];
  const fieldsById = new Map(
    recordType.fields.map((field) => [field.id, field]),
  );

  return uniqueIds.map((fieldId) => fieldsById.get(fieldId)!);
}

function compileRecordType(
  recordType: RecordTypeDefinition,
  presentation: RecordTypePresentationConfig | undefined,
): CompiledRecordTypeConfig {
  const fieldsById = new Map(
    recordType.fields.map((field) => [field.id, field]),
  );

  const listFields = resolveFields(
    recordType,
    presentation?.listFields,
    defaultListFields(recordType),
  );

  const detailFields = resolveFields(
    recordType,
    presentation?.detailFields,
    [...recordType.fields],
  );

  const defaultSort = presentation?.defaultSort
    ? {
        fieldId: presentation.defaultSort.fieldId,
        direction: presentation.defaultSort.direction ?? "asc",
      }
    : undefined;

  return {
    definition: recordType,
    fieldsById,
    listFields,
    detailFields,
    defaultSort,
    formFields: recordType.fields.map(compileFormField),
  };
}

function compileDisclosure(
  definition: DisclosureConfig | undefined,
): CompiledDisclosureConfig {
  const config = definition ?? {};

  return {
    definition: config,
    withheldRecordBehavior:
      config.withheldRecordBehavior ?? "placeholder",
    defaultRedactionText:
      config.defaultRedactionText ?? "[REDACTED]",
    defaultWithheldFieldText:
      config.defaultWithheldFieldText ?? "[WITHHELD]",
    withheldRecordTitle:
      config.withheldRecordTitle ?? "Record withheld",
    withheldRecordSummary:
      config.withheldRecordSummary ??
      "Public contents are withheld.",
    withheldDocumentTitle:
      config.withheldDocumentTitle ?? "Document withheld",
    showReasons: config.showReasons ?? true,
    showAuthorities: config.showAuthorities ?? true,
  };
}

function transitionKey(
  fromStatusId: string,
  toStatusId: string,
): string {
  return `${fromStatusId}->${toStatusId}`;
}

function compilePublicationLifecycle(
  definition: PublicationLifecycleConfig,
): CompiledPublicationLifecycleConfig {
  const statusesById = new Map(
    definition.statuses.map((status) => [
      status.id,
      status,
    ]),
  );
  const transitionsByKey = new Map(
    definition.transitions.map((transition) => [
      transitionKey(
        transition.fromStatusId,
        transition.toStatusId,
      ),
      transition,
    ]),
  );
  const transitionsFromStatus = new Map<
    string,
    PublicationLifecycleConfig["transitions"]
  >();

  for (const transition of definition.transitions) {
    const existing =
      transitionsFromStatus.get(
        transition.fromStatusId,
      ) ?? [];
    transitionsFromStatus.set(
      transition.fromStatusId,
      [...existing, transition],
    );
  }

  const publicStatusIds = new Set(
    definition.statuses
      .filter((status) => status.publiclyVisible === true)
      .map((status) => status.id),
  );

  return {
    definition,
    statusesById,
    transitionsByKey,
    transitionsFromStatus,
    publicStatusIds,
    getStatus(statusId: string) {
      const status = statusesById.get(statusId);

      if (!status) {
        throw new Error(
          `Unknown publication lifecycle status: ${statusId}.`,
        );
      }

      return status;
    },
    getTransition(
      fromStatusId: string,
      toStatusId: string,
    ) {
      return transitionsByKey.get(
        transitionKey(fromStatusId, toStatusId),
      );
    },
    isPublicStatus(statusId: string) {
      return publicStatusIds.has(statusId);
    },
  };
}

export function compileRegistryConfig(
  value: unknown,
): CompiledRegistryConfig {
  assertValidRegistryConfig(value);

  const config = value as RegistryConfigFile;
  const presentation = getPresentationConfig(config);
  const recordTypesById = new Map<string, CompiledRecordTypeConfig>();

  for (const recordType of config.registry.recordTypes) {
    recordTypesById.set(
      recordType.id,
      compileRecordType(
        recordType,
        presentation.recordTypes?.[recordType.id],
      ),
    );
  }

  const relationshipTypesById = new Map(
    (config.registry.relationshipTypes ?? []).map(
      (relationshipType) => [relationshipType.id, relationshipType],
    ),
  );
  const publicationLifecycle =
    config.publicationLifecycle
      ? compilePublicationLifecycle(
          config.publicationLifecycle,
        )
      : undefined;
  const disclosure = compileDisclosure(
    config.disclosure,
  );

  return {
    schemaVersion: config.schemaVersion,
    definition: config.registry,
    recordTypesById,
    relationshipTypesById,
    publicationLifecycle,
    disclosure,
    getRecordType(recordTypeId: string) {
      const recordType = recordTypesById.get(recordTypeId);

      if (!recordType) {
        throw new Error(`Unknown record type: ${recordTypeId}.`);
      }

      return recordType;
    },
    getField(recordTypeId: string, fieldId: string) {
      const field = this.getRecordType(recordTypeId).fieldsById.get(fieldId);

      if (!field) {
        throw new Error(
          `Unknown field ${fieldId} on record type ${recordTypeId}.`,
        );
      }

      return field;
    },
  };
}
