import {
  compileRegistryConfig,
  type CompiledRegistryConfig,
} from "@civic-registry/config";
import type {
  RegistryRecord,
  Relationship,
} from "@civic-registry/core";
import {
  presentRecordSummary,
  type PresentedRecordSummary,
} from "@civic-registry/registry";

import { getRepositories } from "./database";

export interface PublicRegistry {
  config: CompiledRegistryConfig;
}

export interface PublicRelationship {
  relationship: Relationship;
  label: string;
  relatedRecord: PresentedRecordSummary;
}

export async function listPublicRegistries(): Promise<
  PublicRegistry[]
> {
  const { configs } = getRepositories();
  const installed = await configs.list();

  return installed.map((config) => ({
    config: compileRegistryConfig(config),
  }));
}

export async function getPublicRegistry(
  registryId: string,
): Promise<PublicRegistry | null> {
  const { configs } = getRepositories();
  const config = await configs.get(registryId);

  if (!config) return null;

  return {
    config: compileRegistryConfig(config),
  };
}

export async function listPublicRecords(
  registryId: string,
  recordTypeId: string,
): Promise<RegistryRecord[]> {
  const { records } = getRepositories();

  return records.list(registryId, {
    recordTypeId,
    visibility: "public",
    limit: 100,
  });
}

export async function getPublicRecord(
  registryId: string,
  recordId: string,
): Promise<RegistryRecord | null> {
  const { records } = getRepositories();
  const record = await records.get(registryId, recordId);

  if (!record || record.visibility !== "public") {
    return null;
  }

  return record;
}

export async function listPublicRelationships(
  registry: CompiledRegistryConfig,
  record: RegistryRecord,
): Promise<PublicRelationship[]> {
  const { relationships, records } = getRepositories();
  const items = await relationships.list(record.registryId, {
    recordId: record.id,
    direction: "either",
    limit: 100,
  });

  const resolved = await Promise.all(
    items.map(async (relationship) => {
      const isFrom =
        relationship.fromRecordId === record.id;
      const relatedId = isFrom
        ? relationship.toRecordId
        : relationship.fromRecordId;
      const related = await records.get(
        record.registryId,
        relatedId,
      );

      if (!related || related.visibility !== "public") {
        return null;
      }

      const type = registry.relationshipTypesById.get(
        relationship.relationshipTypeId,
      );

      const label = isFrom
        ? (type?.label ?? relationship.relationshipTypeId)
        : (type?.inverseLabel ??
          type?.label ??
          relationship.relationshipTypeId);

      return {
        relationship,
        label,
        relatedRecord: presentRecordSummary(
          related,
          registry,
        ),
      };
    }),
  );

  return resolved.filter(
    (value): value is PublicRelationship =>
      value !== null,
  );
}
