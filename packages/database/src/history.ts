import type {
  AuditEvent,
  RecordVersion,
  RecordVersionOperation,
  RegistryRecord,
  Visibility,
} from "@civic-registry/core";
import type {
  Pool,
  QueryResultRow,
} from "pg";

export interface HistoryListOptions {
  visibility?: Visibility;
  limit?: number;
  offset?: number;
}

export interface EventListOptions
  extends HistoryListOptions {
  eventTypes?: string[];
}

export interface RecordHistoryRepository {
  getVersion(
    registryId: string,
    recordId: string,
    version: number,
  ): Promise<RecordVersion | null>;
  listVersions(
    registryId: string,
    recordId: string,
    options?: HistoryListOptions,
  ): Promise<RecordVersion[]>;
  listEvents(
    registryId: string,
    recordId: string,
    options?: EventListOptions,
  ): Promise<AuditEvent[]>;
}

interface VersionRow extends QueryResultRow {
  registry_id: string;
  record_id: string;
  version: number;
  operation: RecordVersionOperation;
  visibility: Visibility;
  snapshot: RegistryRecord;
  created_at: Date;
  actor_id: string | null;
  reason: string | null;
}

interface EventRow extends QueryResultRow {
  id: string | number;
  registry_id: string;
  subject_type: string;
  subject_id: string;
  event_type: string;
  occurred_at: Date;
  visibility: Visibility;
  actor_id: string | null;
  reason: string | null;
  metadata: AuditEvent["metadata"];
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return 100;
  return Math.max(1, Math.min(Math.trunc(limit), 500));
}

function normalizeOffset(offset: number | undefined): number {
  if (offset === undefined) return 0;
  return Math.max(0, Math.trunc(offset));
}

function mapVersion(row: VersionRow): RecordVersion {
  return {
    id: `${row.registry_id}:${row.record_id}:v${row.version}`,
    registryId: row.registry_id,
    recordId: row.record_id,
    version: row.version,
    operation: row.operation,
    visibility: row.visibility,
    createdAt: row.created_at.toISOString(),
    actorId: row.actor_id ?? undefined,
    reason: row.reason ?? undefined,
    snapshot: row.snapshot,
  };
}

function mapEvent(row: EventRow): AuditEvent {
  return {
    id: String(row.id),
    registryId: row.registry_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    eventType: row.event_type,
    occurredAt: row.occurred_at.toISOString(),
    visibility: row.visibility,
    actorId: row.actor_id ?? undefined,
    reason: row.reason ?? undefined,
    metadata: row.metadata ?? {},
  };
}

export class PostgresRecordHistoryRepository
  implements RecordHistoryRepository
{
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async getVersion(
    registryId: string,
    recordId: string,
    version: number,
  ): Promise<RecordVersion | null> {
    const result = await this.pool.query<VersionRow>(
      `
        SELECT *
        FROM civic_registry_record_versions
        WHERE registry_id = $1
          AND record_id = $2
          AND version = $3
      `,
      [registryId, recordId, version],
    );

    return result.rows[0]
      ? mapVersion(result.rows[0])
      : null;
  }

  async listVersions(
    registryId: string,
    recordId: string,
    options: HistoryListOptions = {},
  ): Promise<RecordVersion[]> {
    const values: unknown[] = [registryId, recordId];
    const where = [
      "registry_id = $1",
      "record_id = $2",
    ];

    if (options.visibility) {
      values.push(options.visibility);
      where.push(`visibility = $${values.length}`);
    }

    values.push(clampLimit(options.limit));
    const limitParameter = `$${values.length}`;
    values.push(normalizeOffset(options.offset));
    const offsetParameter = `$${values.length}`;

    const result = await this.pool.query<VersionRow>(
      `
        SELECT *
        FROM civic_registry_record_versions
        WHERE ${where.join(" AND ")}
        ORDER BY version DESC
        LIMIT ${limitParameter}
        OFFSET ${offsetParameter}
      `,
      values,
    );

    return result.rows.map(mapVersion);
  }

  async listEvents(
    registryId: string,
    recordId: string,
    options: EventListOptions = {},
  ): Promise<AuditEvent[]> {
    const values: unknown[] = [registryId, recordId];
    const where = [
      "registry_id = $1",
      "subject_type = 'record'",
      "subject_id = $2",
    ];

    if (options.visibility) {
      values.push(options.visibility);
      where.push(`visibility = $${values.length}`);
    }

    const eventTypes = [
      ...new Set(
        (options.eventTypes ?? [])
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ];

    if (eventTypes.length > 0) {
      values.push(eventTypes);
      where.push(
        `event_type = ANY($${values.length}::text[])`,
      );
    }

    values.push(clampLimit(options.limit));
    const limitParameter = `$${values.length}`;
    values.push(normalizeOffset(options.offset));
    const offsetParameter = `$${values.length}`;

    const result = await this.pool.query<EventRow>(
      `
        SELECT *
        FROM civic_registry_audit_events
        WHERE ${where.join(" AND ")}
        ORDER BY occurred_at DESC, id DESC
        LIMIT ${limitParameter}
        OFFSET ${offsetParameter}
      `,
      values,
    );

    return result.rows.map(mapEvent);
  }
}
