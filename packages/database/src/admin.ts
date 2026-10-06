import type {
  DeadlineInstance,
  DeadlineState,
} from "@civic-registry/core";
import type {
  Pool,
  QueryResultRow,
} from "pg";

import type {
  TransitionRequest,
} from "./lifecycle.ts";

export interface AdminRegistrySummary {
  registryId: string;
  recordCount: number;
  sourceCount: number;
  pendingApprovalCount: number;
  failedIngestionItemCount: number;
  openDeadlineCount: number;
  overdueDeadlineCount: number;
  sourceRefreshJobCount: number;
  sourceRefreshIssueCount: number;
}

export interface AdminTransitionRequestListOptions {
  status?: TransitionRequest["status"];
  recordId?: string;
  limit?: number;
  offset?: number;
}

export interface AdminDeadlineListOptions {
  states?: DeadlineState[];
  dueBefore?: string;
  dueAfter?: string;
  limit?: number;
  offset?: number;
}

interface SummaryRow extends QueryResultRow {
  record_count: number;
  source_count: number;
  pending_approval_count: number;
  failed_ingestion_item_count: number;
  open_deadline_count: number;
  overdue_deadline_count: number;
  source_refresh_job_count: number;
  source_refresh_issue_count: number;
}

interface RequestRow extends QueryResultRow {
  registry_id: string;
  id: string;
  record_id: string;
  from_status_id: string;
  to_status_id: string;
  status: TransitionRequest["status"];
  requested_by: string | null;
  requested_roles: string[];
  requested_at: Date;
  reason: string | null;
  required_approvals: number;
  requester_cannot_approve: boolean;
  completed_at: Date | null;
}

interface DeadlineRow extends QueryResultRow {
  registry_id: string;
  id: string;
  record_id: string;
  deadline_type_id: string;
  instance_key: string;
  anchor_at: Date;
  due_at: Date;
  state: DeadlineState;
  paused_at: Date | null;
  total_paused_seconds: number | string;
  completed_at: Date | null;
  cancelled_at: Date | null;
  created_at: Date;
  updated_at: Date;
  metadata: DeadlineInstance["metadata"];
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return 100;
  return Math.max(1, Math.min(Math.trunc(limit), 500));
}

function normalizeOffset(offset: number | undefined): number {
  if (offset === undefined) return 0;
  return Math.max(0, Math.trunc(offset));
}

function mapRequest(row: RequestRow): TransitionRequest {
  return {
    id: row.id,
    registryId: row.registry_id,
    recordId: row.record_id,
    fromStatusId: row.from_status_id,
    toStatusId: row.to_status_id,
    status: row.status,
    requestedBy: row.requested_by ?? undefined,
    requestedRoles: row.requested_roles ?? [],
    requestedAt: row.requested_at.toISOString(),
    reason: row.reason ?? undefined,
    requiredApprovals: row.required_approvals,
    requesterCannotApprove: row.requester_cannot_approve,
    completedAt: row.completed_at?.toISOString(),
  };
}

function mapDeadline(row: DeadlineRow): DeadlineInstance {
  return {
    id: row.id,
    registryId: row.registry_id,
    recordId: row.record_id,
    deadlineTypeId: row.deadline_type_id,
    instanceKey: row.instance_key,
    anchorAt: row.anchor_at.toISOString(),
    dueAt: row.due_at.toISOString(),
    state: row.state,
    pausedAt: row.paused_at?.toISOString(),
    totalPausedSeconds: Number(row.total_paused_seconds),
    completedAt: row.completed_at?.toISOString(),
    cancelledAt: row.cancelled_at?.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    metadata: row.metadata ?? {},
  };
}

export class PostgresAdminRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async getRegistrySummary(
    registryId: string,
  ): Promise<AdminRegistrySummary> {
    const result = await this.pool.query<SummaryRow>(
      `
        SELECT
          (
            SELECT COUNT(*)::int
            FROM civic_registry_records
            WHERE registry_id = $1
          ) AS record_count,
          (
            SELECT COUNT(*)::int
            FROM civic_registry_sources
            WHERE registry_id = $1
          ) AS source_count,
          (
            SELECT COUNT(*)::int
            FROM civic_registry_transition_requests
            WHERE registry_id = $1
              AND status = 'pending'
          ) AS pending_approval_count,
          (
            SELECT COUNT(*)::int
            FROM civic_registry_ingestion_items
            WHERE registry_id = $1
              AND outcome = 'failed'
          ) AS failed_ingestion_item_count,
          (
            SELECT COUNT(*)::int
            FROM civic_registry_deadlines
            WHERE registry_id = $1
              AND state IN ('open', 'paused')
          ) AS open_deadline_count,
          (
            SELECT COUNT(*)::int
            FROM civic_registry_deadlines
            WHERE registry_id = $1
              AND state = 'open'
              AND due_at < NOW()
          ) AS overdue_deadline_count,
          (
            SELECT COUNT(*)::int
            FROM civic_registry_source_refresh_jobs
            WHERE registry_id = $1
          ) AS source_refresh_job_count,
          (
            SELECT COUNT(*)::int
            FROM civic_registry_source_refresh_jobs
            WHERE registry_id = $1
              AND enabled = TRUE
              AND (
                last_status IN (
                  'failed',
                  'completed_with_warnings'
                )
                OR (
                  last_completed_at IS NOT NULL
                  AND last_completed_at <
                    NOW() -
                    (
                      stale_after_seconds *
                      INTERVAL '1 second'
                    )
                )
                OR (
                  last_completed_at IS NULL
                  AND created_at <
                    NOW() -
                    (
                      stale_after_seconds *
                      INTERVAL '1 second'
                    )
                )
              )
          ) AS source_refresh_issue_count
      `,
      [registryId],
    );
    const row = result.rows[0];

    return {
      registryId,
      recordCount: row?.record_count ?? 0,
      sourceCount: row?.source_count ?? 0,
      pendingApprovalCount: row?.pending_approval_count ?? 0,
      failedIngestionItemCount:
        row?.failed_ingestion_item_count ?? 0,
      openDeadlineCount: row?.open_deadline_count ?? 0,
      overdueDeadlineCount:
        row?.overdue_deadline_count ?? 0,
      sourceRefreshJobCount:
        row?.source_refresh_job_count ?? 0,
      sourceRefreshIssueCount:
        row?.source_refresh_issue_count ?? 0,
    };
  }

  async listTransitionRequests(
    registryId: string,
    options: AdminTransitionRequestListOptions = {},
  ): Promise<TransitionRequest[]> {
    const values: unknown[] = [registryId];
    const where = ["registry_id = $1"];

    if (options.status) {
      values.push(options.status);
      where.push(`status = $${values.length}`);
    }

    if (options.recordId) {
      values.push(options.recordId);
      where.push(`record_id = $${values.length}`);
    }

    values.push(clampLimit(options.limit));
    const limitParameter = `$${values.length}`;
    values.push(normalizeOffset(options.offset));
    const offsetParameter = `$${values.length}`;

    const result = await this.pool.query<RequestRow>(
      `
        SELECT *
        FROM civic_registry_transition_requests
        WHERE ${where.join(" AND ")}
        ORDER BY requested_at DESC, id DESC
        LIMIT ${limitParameter}
        OFFSET ${offsetParameter}
      `,
      values,
    );

    return result.rows.map(mapRequest);
  }

  async listDeadlines(
    registryId: string,
    options: AdminDeadlineListOptions = {},
  ): Promise<DeadlineInstance[]> {
    const values: unknown[] = [registryId];
    const where = ["registry_id = $1"];
    const states = [
      ...new Set(
        (options.states ?? [])
          .map((state) => state.trim())
          .filter(Boolean),
      ),
    ];

    if (states.length > 0) {
      values.push(states);
      where.push(
        `state = ANY($${values.length}::text[])`,
      );
    }

    if (options.dueBefore) {
      values.push(options.dueBefore);
      where.push(
        `due_at <= $${values.length}::timestamptz`,
      );
    }

    if (options.dueAfter) {
      values.push(options.dueAfter);
      where.push(
        `due_at >= $${values.length}::timestamptz`,
      );
    }

    values.push(clampLimit(options.limit));
    const limitParameter = `$${values.length}`;
    values.push(normalizeOffset(options.offset));
    const offsetParameter = `$${values.length}`;

    const result = await this.pool.query<DeadlineRow>(
      `
        SELECT *
        FROM civic_registry_deadlines
        WHERE ${where.join(" AND ")}
        ORDER BY
          CASE WHEN state = 'open' AND due_at < NOW()
            THEN 0 ELSE 1 END,
          due_at ASC,
          id ASC
        LIMIT ${limitParameter}
        OFFSET ${offsetParameter}
      `,
      values,
    );

    return result.rows.map(mapDeadline);
  }
}
