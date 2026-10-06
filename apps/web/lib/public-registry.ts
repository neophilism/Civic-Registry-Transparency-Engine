import {
  compileRegistryConfig,
  type CompiledRegistryConfig,
} from "@civic-registry/config";
import type {
  RegistryRecord,
} from "@civic-registry/core";
import {
  groupPresentedRelationships,
  presentRelationship,
  presentRelationshipGraph,
  type PresentedRelationship,
  type PresentedRelationshipGraph,
  type PresentedRelationshipGroup,
} from "@civic-registry/registry";
import type {
  SearchRequest,
  SearchResponse,
} from "@civic-registry/search";

import { getRepositories } from "./database";

export interface PublicRegistry {
  config: CompiledRegistryConfig;
}

export interface PublicRelationshipResult {
  relationships: PresentedRelationship[];
  groups: PresentedRelationshipGroup[];
  truncated: boolean;
}

export interface PublicRelationshipGraphResult {
  graph: PresentedRelationshipGraph;
  truncated: boolean;
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
  options: {
    relationshipTypeIds?: string[];
    direction?: "outbound" | "inbound" | "undirected";
    maxNodes?: number;
  } = {},
): Promise<PublicRelationshipResult> {
  const { relationshipGraph } = getRepositories();
  const raw = await relationshipGraph.getGraph({
    registryId: record.registryId,
    rootRecordId: record.id,
    depth: 1,
    relationshipTypeIds: options.relationshipTypeIds,
    visibility: "public",
    maxNodes: options.maxNodes ?? 101,
  });

  if (!raw) {
    return {
      relationships: [],
      groups: [],
      truncated: false,
    };
  }

  const recordsById = new Map(
    raw.nodes.map((node) => [
      node.record.id,
      node.record,
    ]),
  );

  const relationships = raw.edges
    .map((relationship) => {
      const relatedId =
        relationship.fromRecordId === record.id
          ? relationship.toRecordId
          : relationship.fromRecordId;
      const related = recordsById.get(relatedId);

      if (!related) return null;

      return presentRelationship(
        record.id,
        relationship,
        related,
        registry,
      );
    })
    .filter(
      (
        relationship,
      ): relationship is PresentedRelationship =>
        relationship !== null,
    )
    .filter(
      (relationship) =>
        !options.direction ||
        relationship.direction === options.direction,
    );

  return {
    relationships,
    groups: groupPresentedRelationships(relationships),
    truncated: raw.truncated,
  };
}

export async function getPublicRelationshipGraph(
  registry: CompiledRegistryConfig,
  recordId: string,
  options: {
    depth?: number;
    relationshipTypeIds?: string[];
    maxNodes?: number;
  } = {},
): Promise<PublicRelationshipGraphResult | null> {
  const { relationshipGraph } = getRepositories();
  const raw = await relationshipGraph.getGraph({
    registryId: registry.definition.id,
    rootRecordId: recordId,
    depth: options.depth,
    relationshipTypeIds: options.relationshipTypeIds,
    visibility: "public",
    maxNodes: options.maxNodes ?? 100,
  });

  if (!raw) return null;

  return {
    graph: presentRelationshipGraph(raw, registry),
    truncated: raw.truncated,
  };
}

export async function searchPublicRecords(
  registry: CompiledRegistryConfig,
  request: Omit<SearchRequest, "registryId" | "visibility"> &
    Partial<Pick<SearchRequest, "registryId" | "visibility">>,
): Promise<SearchResponse> {
  const { search } = getRepositories();

  return search.search(registry, {
    ...request,
    registryId: registry.definition.id,
    visibility: "public",
  });
}
