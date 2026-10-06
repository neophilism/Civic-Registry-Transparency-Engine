import type {
  CompiledRegistryConfig,
} from "@civic-registry/config";
import type {
  JsonFieldValue,
  RegistryRecord,
  Relationship,
  RelationshipTypeDefinition,
} from "@civic-registry/core";

import {
  presentRecordSummary,
  type PresentedRecordSummary,
} from "./presentation.ts";

export type PresentedRelationshipDirection =
  | "outbound"
  | "inbound"
  | "undirected";

export interface PresentedRelationship {
  id: string;
  relationshipTypeId: string;
  typeLabel: string;
  directionLabel: string;
  direction: PresentedRelationshipDirection;
  directed: boolean;
  rootRecordId: string;
  relatedRecord: PresentedRecordSummary;
  createdAt: string;
  metadata: Record<string, JsonFieldValue>;
}

export interface PresentedRelationshipGroup {
  key: string;
  relationshipTypeId: string;
  label: string;
  direction: PresentedRelationshipDirection;
  count: number;
  relationships: PresentedRelationship[];
}

export interface RelationshipGraphNodeInput {
  record: RegistryRecord;
  distance: number;
}

export interface RelationshipGraphInput {
  rootRecordId: string;
  nodes: RelationshipGraphNodeInput[];
  edges: Relationship[];
}

export interface PresentedRelationshipGraphNode {
  id: string;
  distance: number;
  root: boolean;
  record: PresentedRecordSummary;
}

export interface PresentedRelationshipGraphEdge {
  id: string;
  relationshipTypeId: string;
  label: string;
  inverseLabel?: string;
  directed: boolean;
  fromRecordId: string;
  toRecordId: string;
  createdAt: string;
  metadata: Record<string, JsonFieldValue>;
}

export interface PresentedRelationshipGraph {
  rootRecordId: string;
  nodes: PresentedRelationshipGraphNode[];
  edges: PresentedRelationshipGraphEdge[];
  maxDistance: number;
}

function relationshipType(
  registry: CompiledRegistryConfig,
  relationship: Relationship,
): RelationshipTypeDefinition | undefined {
  return registry.relationshipTypesById.get(
    relationship.relationshipTypeId,
  );
}

export function relationshipDirection(
  rootRecordId: string,
  relationship: Relationship,
  type: RelationshipTypeDefinition | undefined,
): PresentedRelationshipDirection {
  if (type?.directed === false) {
    return "undirected";
  }

  return relationship.fromRecordId === rootRecordId
    ? "outbound"
    : "inbound";
}

export function relationshipDirectionLabel(
  rootRecordId: string,
  relationship: Relationship,
  type: RelationshipTypeDefinition | undefined,
): string {
  const fallback = relationship.relationshipTypeId;

  if (type?.directed === false) {
    return type.label || fallback;
  }

  if (relationship.fromRecordId === rootRecordId) {
    return type?.label ?? fallback;
  }

  return type?.inverseLabel ?? type?.label ?? fallback;
}

export function relatedRecordId(
  rootRecordId: string,
  relationship: Relationship,
): string {
  if (relationship.fromRecordId === rootRecordId) {
    return relationship.toRecordId;
  }

  if (relationship.toRecordId === rootRecordId) {
    return relationship.fromRecordId;
  }

  throw new Error(
    `Relationship ${relationship.id} is not connected to root record ${rootRecordId}.`,
  );
}

export function presentRelationship(
  rootRecordId: string,
  relationship: Relationship,
  relatedRecord: RegistryRecord,
  registry: CompiledRegistryConfig,
): PresentedRelationship {
  const type = relationshipType(registry, relationship);
  const direction = relationshipDirection(
    rootRecordId,
    relationship,
    type,
  );

  return {
    id: relationship.id,
    relationshipTypeId: relationship.relationshipTypeId,
    typeLabel: type?.label ?? relationship.relationshipTypeId,
    directionLabel: relationshipDirectionLabel(
      rootRecordId,
      relationship,
      type,
    ),
    direction,
    directed: type?.directed !== false,
    rootRecordId,
    relatedRecord: presentRecordSummary(
      relatedRecord,
      registry,
    ),
    createdAt: relationship.createdAt,
    metadata: relationship.metadata ?? {},
  };
}

export function groupPresentedRelationships(
  relationships: PresentedRelationship[],
): PresentedRelationshipGroup[] {
  const groups = new Map<
    string,
    PresentedRelationshipGroup
  >();

  for (const relationship of relationships) {
    const key = [
      relationship.relationshipTypeId,
      relationship.direction,
      relationship.directionLabel,
    ].join(":");
    const existing = groups.get(key);

    if (existing) {
      existing.relationships.push(relationship);
      existing.count += 1;
      continue;
    }

    groups.set(key, {
      key,
      relationshipTypeId:
        relationship.relationshipTypeId,
      label: relationship.directionLabel,
      direction: relationship.direction,
      count: 1,
      relationships: [relationship],
    });
  }

  return [...groups.values()].sort((left, right) =>
    left.label.localeCompare(right.label),
  );
}

export function presentRelationshipGraph(
  graph: RelationshipGraphInput,
  registry: CompiledRegistryConfig,
): PresentedRelationshipGraph {
  const nodes = graph.nodes
    .map((node) => ({
      id: node.record.id,
      distance: node.distance,
      root: node.record.id === graph.rootRecordId,
      record: presentRecordSummary(
        node.record,
        registry,
      ),
    }))
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        left.record.title.localeCompare(
          right.record.title,
        ),
    );

  const edges = graph.edges.map((relationship) => {
    const type = relationshipType(
      registry,
      relationship,
    );

    return {
      id: relationship.id,
      relationshipTypeId:
        relationship.relationshipTypeId,
      label:
        type?.label ??
        relationship.relationshipTypeId,
      inverseLabel: type?.inverseLabel,
      directed: type?.directed !== false,
      fromRecordId: relationship.fromRecordId,
      toRecordId: relationship.toRecordId,
      createdAt: relationship.createdAt,
      metadata: relationship.metadata ?? {},
    };
  });

  return {
    rootRecordId: graph.rootRecordId,
    nodes,
    edges,
    maxDistance: nodes.reduce(
      (maximum, node) =>
        Math.max(maximum, node.distance),
      0,
    ),
  };
}
