import {
  compileRegistryConfig,
  type CompiledRegistryConfig,
} from "@civic-registry/config";
import type {
  RegistryRecord,
} from "@civic-registry/core";
import {
  groupPresentedCitations,
  groupPresentedRelationships,
  presentHistoryEvent,
  presentRecordRevisions,
  presentCitation,
  presentRelationship,
  presentRelationshipGraph,
  type PresentedCitation,
  type PresentedCitationGroup,
  type PresentedHistoryEvent,
  type PresentedRecordRevision,
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

export interface PublicHistoryResult {
  events: PresentedHistoryEvent[];
  revisions: PresentedRecordRevision[];
}

export interface PublicEvidenceResult {
  citations: PresentedCitation[];
  groups: PresentedCitationGroup[];
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

function publicStatusIds(
  registry: CompiledRegistryConfig,
): string[] | undefined {
  const lifecycle = registry.publicationLifecycle;

  if (!lifecycle) return undefined;

  return [...lifecycle.publicStatusIds];
}

function lifecycleStatusAtEvent(
  event: {
    occurredAt: string;
    version?: number;
  },
  versions: Array<{
    version: number;
    createdAt: string;
    snapshot: RegistryRecord;
  }>,
): string | undefined {
  if (event.version !== undefined) {
    return versions.find(
      (version) => version.version === event.version,
    )?.snapshot.status;
  }

  const eventTime = Date.parse(event.occurredAt);
  let selected:
    | {
        createdAt: string;
        snapshot: RegistryRecord;
      }
    | undefined;

  for (const version of versions) {
    const versionTime = Date.parse(version.createdAt);

    if (
      versionTime <= eventTime &&
      (!selected ||
        versionTime >= Date.parse(selected.createdAt))
    ) {
      selected = version;
    }
  }

  return selected?.snapshot.status;
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
  const { configs, records } = getRepositories();
  const config = await configs.get(registryId);

  if (!config) return [];

  const registry = compileRegistryConfig(config);
  const statuses = publicStatusIds(registry);

  if (
    registry.publicationLifecycle &&
    statuses?.length === 0
  ) {
    return [];
  }

  return records.list(registryId, {
    recordTypeId,
    statuses,
    visibility: "public",
    limit: 100,
  });
}

export async function getPublicRecord(
  registryId: string,
  recordId: string,
): Promise<RegistryRecord | null> {
  const { configs, records } = getRepositories();
  const [config, record] = await Promise.all([
    configs.get(registryId),
    records.get(registryId, recordId),
  ]);

  if (
    !config ||
    !record ||
    record.visibility !== "public"
  ) {
    return null;
  }

  const registry = compileRegistryConfig(config);

  if (
    registry.publicationLifecycle &&
    !registry.publicationLifecycle.isPublicStatus(
      record.status,
    )
  ) {
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
    statusIds: publicStatusIds(registry),
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
    statusIds: publicStatusIds(registry),
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
  const lifecycle = registry.publicationLifecycle;
  let statuses = request.statuses;

  if (lifecycle) {
    const publiclyVisible = lifecycle.publicStatusIds;
    const requested = request.statuses ?? [];

    statuses =
      requested.length > 0
        ? requested.filter((status) =>
            publiclyVisible.has(status),
          )
        : [...publiclyVisible];

    if (statuses.length === 0) {
      statuses = ["__no_public_lifecycle_status__"];
    }
  }

  return search.search(registry, {
    ...request,
    statuses,
    registryId: registry.definition.id,
    visibility: "public",
  });
}


export async function getPublicEvidence(
  registry: CompiledRegistryConfig,
  record: RegistryRecord,
): Promise<PublicEvidenceResult> {
  const { citations } = getRepositories();
  const evidence = await citations.listEvidenceForRecord(
    registry.definition.id,
    record.id,
    {
      visibility: "public",
      limit: 500,
    },
  );
  const presented = evidence.map((item) =>
    presentCitation(item, record, registry),
  );

  return {
    citations: presented,
    groups: groupPresentedCitations(presented),
  };
}


export async function getPublicHistory(
  registry: CompiledRegistryConfig,
  record: RegistryRecord,
): Promise<PublicHistoryResult> {
  const { history } = getRepositories();
  const [events, versions] = await Promise.all([
    history.listEvents(
      registry.definition.id,
      record.id,
      {
        visibility: "public",
        limit: 500,
      },
    ),
    history.listVersions(
      registry.definition.id,
      record.id,
      {
        visibility: "public",
        limit: 500,
      },
    ),
  ]);

  const lifecycle = registry.publicationLifecycle;
  const publicVersions = lifecycle
    ? versions.filter((version) =>
        lifecycle.isPublicStatus(
          version.snapshot.status,
        ),
      )
    : versions;
  const presentedEvents = events.map((event) =>
    presentHistoryEvent(
      event,
      record,
      registry,
    ),
  );
  const publicEvents = lifecycle
    ? presentedEvents.filter((event) => {
        const status = lifecycleStatusAtEvent(
          event,
          versions,
        );

        return (
          status !== undefined &&
          lifecycle.isPublicStatus(status)
        );
      })
    : presentedEvents;

  return {
    events: publicEvents,
    revisions: presentRecordRevisions(
      publicVersions,
      registry,
    ),
  };
}
