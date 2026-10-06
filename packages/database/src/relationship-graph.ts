import type {
  RegistryRecord,
  Relationship,
  Visibility,
} from "@civic-registry/core";
import type {
  Pool,
  QueryResultRow,
} from "pg";

export type RelationshipTraversalDirection =
  | "outbound"
  | "inbound"
  | "either";

export interface RelationshipGraphQuery {
  registryId: string;
  rootRecordId: string;
  depth?: number;
  relationshipTypeIds?: string[];
  statusIds?: string[];
  direction?: RelationshipTraversalDirection;
  visibility?: Visibility;
  maxNodes?: number;
}

export interface RelationshipGraphNode {
  record: RegistryRecord;
  distance: number;
}

export interface RelationshipGraphResult {
  rootRecordId: string;
  nodes: RelationshipGraphNode[];
  edges: Relationship[];
  truncated: boolean;
}

interface EdgeRow extends QueryResultRow {
  registry_id: string;
  id: string;
  relationship_type_id: string;
  from_record_id: string;
  to_record_id: string;
  created_at: Date;
  metadata: Relationship["metadata"];
}

interface RecordRow extends QueryResultRow {
  registry_id: string;
  id: string;
  record_type_id: string;
  fields: RegistryRecord["fields"];
  status: string;
  visibility: RegistryRecord["visibility"];
  external_identifiers: RegistryRecord["externalIdentifiers"];
  tags: string[];
  created_at: Date;
  updated_at: Date;
  published_at: Date | null;
}

function mapRelationship(row: EdgeRow): Relationship {
  return {
    id: row.id,
    registryId: row.registry_id,
    relationshipTypeId: row.relationship_type_id,
    fromRecordId: row.from_record_id,
    toRecordId: row.to_record_id,
    createdAt: row.created_at.toISOString(),
    metadata: row.metadata ?? {},
  };
}

function mapRecord(row: RecordRow): RegistryRecord {
  return {
    id: row.id,
    registryId: row.registry_id,
    recordTypeId: row.record_type_id,
    fields: row.fields,
    status: row.status,
    visibility: row.visibility,
    externalIdentifiers: row.external_identifiers ?? [],
    tags: row.tags ?? [],
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    publishedAt: row.published_at?.toISOString(),
  };
}

function normalizeDepth(depth: number | undefined): number {
  return Math.max(1, Math.min(3, Math.trunc(depth ?? 1)));
}

function normalizeMaxNodes(
  maxNodes: number | undefined,
): number {
  return Math.max(
    1,
    Math.min(250, Math.trunc(maxNodes ?? 100)),
  );
}

function uniqueStrings(
  values: string[] | undefined,
): string[] {
  return [
    ...new Set(
      (values ?? [])
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

export class PostgresRelationshipGraphRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  private async loadEdges(
    query: RelationshipGraphQuery,
    frontier: string[],
  ): Promise<Relationship[]> {
    const values: unknown[] = [
      query.registryId,
      frontier,
    ];
    const where = [
      "rel.registry_id = $1",
    ];
    const frontierParameter = "$2";
    const direction = query.direction ?? "either";

    if (direction === "outbound") {
      where.push(
        `rel.from_record_id = ANY(${frontierParameter}::text[])`,
      );
    } else if (direction === "inbound") {
      where.push(
        `rel.to_record_id = ANY(${frontierParameter}::text[])`,
      );
    } else {
      where.push(
        `(
          rel.from_record_id = ANY(${frontierParameter}::text[])
          OR rel.to_record_id = ANY(${frontierParameter}::text[])
        )`,
      );
    }

    const relationshipTypeIds = uniqueStrings(
      query.relationshipTypeIds,
    );

    if (relationshipTypeIds.length > 0) {
      values.push(relationshipTypeIds);
      where.push(
        `rel.relationship_type_id = ANY($${values.length}::text[])`,
      );
    }

    if (query.visibility) {
      values.push(query.visibility);
      const visibilityParameter = `${values.length}`;
      where.push(
        `from_record.visibility = ${visibilityParameter}`,
      );
      where.push(
        `to_record.visibility = ${visibilityParameter}`,
      );
    }

    const statusIds = uniqueStrings(query.statusIds);

    if (statusIds.length > 0) {
      values.push(statusIds);
      const statusParameter = `${values.length}`;
      where.push(
        `from_record.status = ANY(${statusParameter}::text[])`,
      );
      where.push(
        `to_record.status = ANY(${statusParameter}::text[])`,
      );
    }

    const result = await this.pool.query<EdgeRow>(
      `
        SELECT rel.*
        FROM civic_registry_relationships AS rel
        INNER JOIN civic_registry_records AS from_record
          ON from_record.registry_id = rel.registry_id
          AND from_record.id = rel.from_record_id
        INNER JOIN civic_registry_records AS to_record
          ON to_record.registry_id = rel.registry_id
          AND to_record.id = rel.to_record_id
        WHERE ${where.join(" AND ")}
        ORDER BY rel.created_at DESC, rel.id ASC
      `,
      values,
    );

    return result.rows.map(mapRelationship);
  }

  async getGraph(
    query: RelationshipGraphQuery,
  ): Promise<RelationshipGraphResult | null> {
    const depth = normalizeDepth(query.depth);
    const maxNodes = normalizeMaxNodes(
      query.maxNodes,
    );
    const rootValues: unknown[] = [
      query.registryId,
      query.rootRecordId,
    ];
    const rootWhere = [
      "registry_id = $1",
      "id = $2",
    ];

    if (query.visibility) {
      rootValues.push(query.visibility);
      rootWhere.push(
        `visibility = ${rootValues.length}`,
      );
    }

    const statusIds = uniqueStrings(query.statusIds);

    if (statusIds.length > 0) {
      rootValues.push(statusIds);
      rootWhere.push(
        `status = ANY(${rootValues.length}::text[])`,
      );
    }

    const root = await this.pool.query<RecordRow>(
      `
        SELECT *
        FROM civic_registry_records
        WHERE ${rootWhere.join(" AND ")}
      `,
      rootValues,
    );

    if (!root.rows[0]) return null;

    const distances = new Map<string, number>([
      [query.rootRecordId, 0],
    ]);
    const selectedIds = new Set<string>([
      query.rootRecordId,
    ]);
    const edges = new Map<string, Relationship>();
    let frontier = [query.rootRecordId];
    let truncated = false;

    for (
      let currentDepth = 1;
      currentDepth <= depth && frontier.length > 0;
      currentDepth += 1
    ) {
      const levelEdges = await this.loadEdges(
        query,
        frontier,
      );
      const nextFrontier = new Set<string>();
      const frontierSet = new Set(frontier);

      for (const edge of levelEdges) {
        const candidateIds = [
          edge.fromRecordId,
          edge.toRecordId,
        ];
        const newIds = candidateIds.filter(
          (id) => !selectedIds.has(id),
        );

        if (
          newIds.length > 0 &&
          selectedIds.size + newIds.length > maxNodes
        ) {
          truncated = true;
          continue;
        }

        edges.set(edge.id, edge);

        for (const id of candidateIds) {
          if (!selectedIds.has(id)) {
            selectedIds.add(id);
            distances.set(id, currentDepth);
          }

          if (
            !frontierSet.has(id) &&
            distances.get(id) === currentDepth
          ) {
            nextFrontier.add(id);
          }
        }
      }

      frontier = [...nextFrontier];
    }

    const ids = [...selectedIds];
    const values: unknown[] = [
      query.registryId,
      ids,
    ];
    const where = [
      "registry_id = $1",
      "id = ANY($2::text[])",
    ];

    if (query.visibility) {
      values.push(query.visibility);
      where.push(
        `visibility = ${values.length}`,
      );
    }

    if (statusIds.length > 0) {
      values.push(statusIds);
      where.push(
        `status = ANY(${values.length}::text[])`,
      );
    }

    const records = await this.pool.query<RecordRow>(
      `
        SELECT *
        FROM civic_registry_records
        WHERE ${where.join(" AND ")}
      `,
      values,
    );

    const nodes = records.rows.map((row) => {
      const record = mapRecord(row);

      return {
        record,
        distance:
          distances.get(record.id) ?? depth,
      };
    });

    return {
      rootRecordId: query.rootRecordId,
      nodes,
      edges: [...edges.values()],
      truncated,
    };
  }
}
