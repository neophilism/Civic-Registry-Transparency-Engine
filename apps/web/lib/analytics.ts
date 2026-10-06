import type { CompiledRegistryConfig } from "@civic-registry/config";
import type { RegistryAnalytics } from "@civic-registry/database";

import { getRepositories } from "./database";

function publicStatusIds(
  config: CompiledRegistryConfig,
): string[] | undefined {
  return config.publicationLifecycle
    ? [...config.publicationLifecycle.publicStatusIds]
    : undefined;
}

function publicDeadlineTypeIds(
  config: CompiledRegistryConfig,
): string[] {
  return config.deadlines
    ? [...config.deadlines.definitionsById.values()]
        .filter((definition) => definition.publiclyVisible === true)
        .map((definition) => definition.id)
    : [];
}

export function analyticsDimensionCandidates(
  config: CompiledRegistryConfig,
): Array<{
  recordTypeId: string;
  fieldId: string;
  label: string;
}> {
  return [...config.recordTypesById.values()].flatMap(
    (recordType) =>
      recordType.definition.fields
        .filter((field) => field.filterable === true)
        .map((field) => ({
          recordTypeId: recordType.definition.id,
          fieldId: field.id,
          label:
            recordType.definition.name + " · " + field.label,
        })),
  );
}

export async function getPublicAnalytics(
  config: CompiledRegistryConfig,
  dimension?: {
    recordTypeId: string;
    fieldId: string;
  },
): Promise<RegistryAnalytics> {
  const allowed = analyticsDimensionCandidates(config);
  const safeDimension =
    dimension &&
    allowed.some(
      (candidate) =>
        candidate.recordTypeId === dimension.recordTypeId &&
        candidate.fieldId === dimension.fieldId,
    )
      ? dimension
      : undefined;

  return getRepositories().analytics.getRegistryAnalytics(
    config.definition.id,
    {
      scope: "public",
      publicStatusIds: publicStatusIds(config),
      publicDeadlineTypeIds:
        publicDeadlineTypeIds(config),
      excludeWithheld:
        config.disclosure.withheldRecordBehavior === "hidden",
      dimensionFieldId: safeDimension?.fieldId,
      dimensionRecordTypeId:
        safeDimension?.recordTypeId,
    },
  );
}

export async function getAdminAnalytics(
  config: CompiledRegistryConfig,
  dimension?: {
    recordTypeId: string;
    fieldId: string;
  },
): Promise<RegistryAnalytics> {
  const allowed = analyticsDimensionCandidates(config);
  const safeDimension =
    dimension &&
    allowed.some(
      (candidate) =>
        candidate.recordTypeId === dimension.recordTypeId &&
        candidate.fieldId === dimension.fieldId,
    )
      ? dimension
      : undefined;

  return getRepositories().analytics.getRegistryAnalytics(
    config.definition.id,
    {
      scope: "internal",
      dimensionFieldId: safeDimension?.fieldId,
      dimensionRecordTypeId:
        safeDimension?.recordTypeId,
    },
  );
}
