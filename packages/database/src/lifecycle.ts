import { randomUUID } from "node:crypto";

import {
  compileRegistryConfig,
  type CompiledPublicationLifecycleConfig,
  type CompiledRegistryConfig,
  type PublicationTransitionConfig,
  type RegistryConfigFile,
} from "@civic-registry/config";
import type {
  AuditEvent,
  RegistryRecord,
} from "@civic-registry/core";
import type {
  Pool,
  PoolClient,
  QueryResultRow,
} from "pg";

import {
  PersistenceConflictError,
  PersistenceNotFoundError,
} from "./repositories.ts";

export interface LifecycleActorContext {
  actorId?: string;
  roles?: string[];
  reason?: string;
}

export interface TransitionRequest {
  id: string;
  registryId: string;
  recordId: string;
  fromStatusId: string;
  toStatusId: string;
  status: "pending" | "executed" | "rejected" | "cancelled";
  requestedBy?: string;
  requestedRoles: string[];
  requestedAt: string;
  reason?: string;
  requiredApprovals: number;
  requesterCannotApprove: boolean;
  completedAt?: string;
}

export interface TransitionDecision {
  registryId: string;
  requestId: string;
  actorId: string;
  decision: "approved" | "rejected";
  actorRoles: string[];
  decidedAt: string;
  note?: string;
}

export interface PublicationSchedule {
  id: string;
  registryId: string;
  recordId: string;
  fromStatusId: string;
  targetStatusId: string;
  scheduledFor: string;
  status: "pending" | "executed" | "cancelled" | "failed";
  requestedBy?: string;
  requestedRoles: string[];
  reason?: string;
  createdAt: string;
  completedAt?: string;
  failureReason?: string;
}

export type TransitionRequestResult =
  | {
      kind: "executed";
      record: RegistryRecord;
    }
  | {
      kind: "pending_approval";
      request: TransitionRequest;
    };

export interface TransitionDecisionResult {
  request: TransitionRequest;
  record?: RegistryRecord;
  approvals: number;
}

export interface ProcessSchedulesResult {
  examined: number;
  executed: number;
  failed: number;
  skipped: number;
}

export class PublicationLifecycleError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PublicationLifecycleError";
    this.code = code;
  }
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

interface DecisionRow extends QueryResultRow {
  registry_id: string;
  request_id: string;
  actor_id: string;
  decision: TransitionDecision["decision"];
  actor_roles: string[];
  decided_at: Date;
  note: string | null;
}

interface ScheduleRow extends QueryResultRow {
  registry_id: string;
  id: string;
  record_id: string;
  from_status_id: string;
  target_status_id: string;
  scheduled_for: Date;
  status: PublicationSchedule["status"];
  requested_by: string | null;
  requested_roles: string[];
  reason: string | null;
  created_at: Date;
  completed_at: Date | null;
  failure_reason: string | null;
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

function mapDecision(row: DecisionRow): TransitionDecision {
  return {
    registryId: row.registry_id,
    requestId: row.request_id,
    actorId: row.actor_id,
    decision: row.decision,
    actorRoles: row.actor_roles ?? [],
    decidedAt: row.decided_at.toISOString(),
    note: row.note ?? undefined,
  };
}

function mapSchedule(row: ScheduleRow): PublicationSchedule {
  return {
    id: row.id,
    registryId: row.registry_id,
    recordId: row.record_id,
    fromStatusId: row.from_status_id,
    targetStatusId: row.target_status_id,
    scheduledFor: row.scheduled_for.toISOString(),
    status: row.status,
    requestedBy: row.requested_by ?? undefined,
    requestedRoles: row.requested_roles ?? [],
    reason: row.reason ?? undefined,
    createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at?.toISOString(),
    failureReason: row.failure_reason ?? undefined,
  };
}

function normalizedRoles(
  roles: string[] | undefined,
): string[] {
  return [
    ...new Set(
      (roles ?? [])
        .map((role) => role.trim())
        .filter(Boolean),
    ),
  ];
}

function requireAnyRole(
  actorRoles: string[],
  allowedRoles: string[] | undefined,
  action: string,
): void {
  if (!allowedRoles || allowedRoles.length === 0) return;

  if (
    !allowedRoles.some((role) =>
      actorRoles.includes(role),
    )
  ) {
    throw new PublicationLifecycleError(
      "forbidden",
      `At least one of these roles is required to ${action}: ${allowedRoles.join(", ")}.`,
    );
  }
}

async function loadRegistry(
  client: PoolClient,
  registryId: string,
): Promise<CompiledRegistryConfig> {
  const result = await client.query<{
    config: RegistryConfigFile;
  }>(
    `
      SELECT config
      FROM civic_registry_configurations
      WHERE registry_id = $1
    `,
    [registryId],
  );

  const config = result.rows[0]?.config;

  if (!config) {
    throw new PersistenceNotFoundError(
      `Registry configuration ${registryId} does not exist.`,
    );
  }

  return compileRegistryConfig(config);
}

function requireLifecycle(
  registry: CompiledRegistryConfig,
): CompiledPublicationLifecycleConfig {
  if (!registry.publicationLifecycle) {
    throw new PublicationLifecycleError(
      "lifecycle_not_configured",
      `Registry ${registry.definition.id} does not configure a publication lifecycle.`,
    );
  }

  return registry.publicationLifecycle;
}

async function lockRecord(
  client: PoolClient,
  registryId: string,
  recordId: string,
): Promise<RecordRow> {
  const result = await client.query<RecordRow>(
    `
      SELECT *
      FROM civic_registry_records
      WHERE registry_id = $1
        AND id = $2
      FOR UPDATE
    `,
    [registryId, recordId],
  );

  const record = result.rows[0];

  if (!record) {
    throw new PersistenceNotFoundError(
      `Record ${registryId}/${recordId} does not exist.`,
    );
  }

  return record;
}

function requireTransition(
  lifecycle: CompiledPublicationLifecycleConfig,
  fromStatusId: string,
  toStatusId: string,
): PublicationTransitionConfig {
  const transition = lifecycle.getTransition(
    fromStatusId,
    toStatusId,
  );

  if (!transition) {
    throw new PublicationLifecycleError(
      "transition_not_allowed",
      `Transition ${fromStatusId}->${toStatusId} is not configured.`,
    );
  }

  return transition;
}

async function setHistoryContext(
  client: PoolClient,
  context: LifecycleActorContext,
): Promise<void> {
  await client.query(
    `
      SELECT set_config(
        'civic_registry.actor_id',
        $1,
        true
      )
    `,
    [context.actorId ?? ""],
  );
  await client.query(
    `
      SELECT set_config(
        'civic_registry.reason',
        $1,
        true
      )
    `,
    [context.reason ?? ""],
  );
}

async function insertAuditEvent(
  client: PoolClient,
  event: Omit<AuditEvent, "id">,
): Promise<void> {
  await client.query(
    `
      INSERT INTO civic_registry_audit_events (
        registry_id,
        subject_type,
        subject_id,
        event_type,
        occurred_at,
        visibility,
        actor_id,
        reason,
        metadata
      )
      VALUES (
        $1, $2, $3, $4,
        $5::timestamptz, $6, $7, $8, $9::jsonb
      )
    `,
    [
      event.registryId,
      event.subjectType,
      event.subjectId,
      event.eventType,
      event.occurredAt,
      event.visibility,
      event.actorId ?? null,
      event.reason ?? null,
      JSON.stringify(event.metadata ?? {}),
    ],
  );
}

async function cancelStaleWorkflow(
  client: PoolClient,
  registryId: string,
  recordId: string,
  completedAt: string,
  options: {
    keepRequestId?: string;
    keepScheduleId?: string;
  } = {},
): Promise<void> {
  const requestValues: unknown[] = [
    registryId,
    recordId,
    completedAt,
  ];
  let requestExclusion = "";

  if (options.keepRequestId) {
    requestValues.push(options.keepRequestId);
    requestExclusion = `AND id <> $${requestValues.length}`;
  }

  await client.query(
    `
      UPDATE civic_registry_transition_requests
      SET
        status = 'cancelled',
        completed_at = $3::timestamptz
      WHERE registry_id = $1
        AND record_id = $2
        AND status = 'pending'
        ${requestExclusion}
    `,
    requestValues,
  );

  const scheduleValues: unknown[] = [
    registryId,
    recordId,
    completedAt,
  ];
  let scheduleExclusion = "";

  if (options.keepScheduleId) {
    scheduleValues.push(options.keepScheduleId);
    scheduleExclusion =
      `AND id <> $${scheduleValues.length}`;
  }

  await client.query(
    `
      UPDATE civic_registry_publication_schedules
      SET
        status = 'cancelled',
        completed_at = $3::timestamptz,
        failure_reason =
          'Record status changed before this schedule executed.'
      WHERE registry_id = $1
        AND record_id = $2
        AND status = 'pending'
        ${scheduleExclusion}
    `,
    scheduleValues,
  );
}

async function applyTransition(
  client: PoolClient,
  registry: CompiledRegistryConfig,
  record: RecordRow,
  targetStatusId: string,
  context: LifecycleActorContext,
  now: string,
  options: {
    keepRequestId?: string;
    keepScheduleId?: string;
  } = {},
): Promise<RegistryRecord> {
  const lifecycle = requireLifecycle(registry);
  const target = lifecycle.getStatus(targetStatusId);

  await setHistoryContext(client, context);
  await client.query(
    `
      SELECT set_config(
        'civic_registry.lifecycle_transition',
        'allowed',
        true
      )
    `,
  );
  await cancelStaleWorkflow(
    client,
    record.registry_id,
    record.id,
    now,
    options,
  );

  const result = await client.query<RecordRow>(
    `
      UPDATE civic_registry_records
      SET
        status = $3,
        updated_at = $4::timestamptz,
        published_at = CASE
          WHEN $5::boolean
            THEN COALESCE(
              published_at,
              $4::timestamptz
            )
          ELSE published_at
        END
      WHERE registry_id = $1
        AND id = $2
      RETURNING *
    `,
    [
      record.registry_id,
      record.id,
      targetStatusId,
      now,
      target.marksPublished === true,
    ],
  );

  const updated = result.rows[0];

  if (!updated) {
    throw new PersistenceNotFoundError(
      `Record ${record.registry_id}/${record.id} disappeared during lifecycle transition.`,
    );
  }

  await insertAuditEvent(client, {
    registryId: record.registry_id,
    subjectType: "record",
    subjectId: record.id,
    eventType: "lifecycle.transition_executed",
    occurredAt: now,
    visibility: "private",
    actorId: context.actorId,
    reason: context.reason,
    metadata: {
      fromStatusId: record.status,
      toStatusId: targetStatusId,
    },
  });

  return mapRecord(updated);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

export class PostgresPublicationLifecycleService {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async requestTransition(input: {
    registryId: string;
    recordId: string;
    toStatusId: string;
    context?: LifecycleActorContext;
    now?: string;
  }): Promise<TransitionRequestResult> {
    const client = await this.pool.connect();
    const context = {
      ...input.context,
      roles: normalizedRoles(input.context?.roles),
    };
    const now =
      input.now ?? new Date().toISOString();

    try {
      await client.query("BEGIN");
      const registry = await loadRegistry(
        client,
        input.registryId,
      );
      const lifecycle = requireLifecycle(registry);
      const record = await lockRecord(
        client,
        input.registryId,
        input.recordId,
      );

      lifecycle.getStatus(record.status);
      lifecycle.getStatus(input.toStatusId);
      const transition = requireTransition(
        lifecycle,
        record.status,
        input.toStatusId,
      );

      requireAnyRole(
        context.roles,
        transition.allowedRoles,
        "request this lifecycle transition",
      );

      if (!transition.approval) {
        const updated = await applyTransition(
          client,
          registry,
          record,
          input.toStatusId,
          context,
          now,
        );
        await client.query("COMMIT");

        return {
          kind: "executed",
          record: updated,
        };
      }

      const requestId = randomUUID();
      const requiredApprovals =
        transition.approval.minApprovals ?? 1;

      let result;

      try {
        result = await client.query<RequestRow>(
          `
            INSERT INTO civic_registry_transition_requests (
              registry_id,
              id,
              record_id,
              from_status_id,
              to_status_id,
              status,
              requested_by,
              requested_roles,
              requested_at,
              reason,
              required_approvals,
              requester_cannot_approve
            )
            VALUES (
              $1, $2, $3, $4, $5,
              'pending', $6, $7::text[],
              $8::timestamptz, $9, $10, $11
            )
            RETURNING *
          `,
          [
            input.registryId,
            requestId,
            input.recordId,
            record.status,
            input.toStatusId,
            context.actorId ?? null,
            context.roles,
            now,
            context.reason ?? null,
            requiredApprovals,
            transition.approval
              .requesterCannotApprove === true,
          ],
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new PersistenceConflictError(
            "A pending request for this record and target status already exists.",
          );
        }

        throw error;
      }

      await insertAuditEvent(client, {
        registryId: input.registryId,
        subjectType: "record",
        subjectId: input.recordId,
        eventType: "lifecycle.transition_requested",
        occurredAt: now,
        visibility: "private",
        actorId: context.actorId,
        reason: context.reason,
        metadata: {
          requestId,
          fromStatusId: record.status,
          toStatusId: input.toStatusId,
          requiredApprovals,
        },
      });

      await client.query("COMMIT");

      return {
        kind: "pending_approval",
        request: mapRequest(result.rows[0]),
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async decideTransition(input: {
    registryId: string;
    requestId: string;
    decision: "approved" | "rejected";
    actorId: string;
    actorRoles: string[];
    note?: string;
    now?: string;
  }): Promise<TransitionDecisionResult> {
    const client = await this.pool.connect();
    const actorRoles = normalizedRoles(
      input.actorRoles,
    );

    if (!input.actorId.trim()) {
      throw new PublicationLifecycleError(
        "actor_required",
        "Approval decisions require a non-empty actorId.",
      );
    }

    const now =
      input.now ?? new Date().toISOString();

    try {
      await client.query("BEGIN");

      const requestResult =
        await client.query<RequestRow>(
          `
            SELECT *
            FROM civic_registry_transition_requests
            WHERE registry_id = $1
              AND id = $2
            FOR UPDATE
          `,
          [input.registryId, input.requestId],
        );
      const request = requestResult.rows[0];

      if (!request) {
        throw new PersistenceNotFoundError(
          `Transition request ${input.registryId}/${input.requestId} does not exist.`,
        );
      }

      if (request.status !== "pending") {
        throw new PublicationLifecycleError(
          "request_not_pending",
          `Transition request ${input.requestId} is ${request.status}, not pending.`,
        );
      }

      const registry = await loadRegistry(
        client,
        input.registryId,
      );
      const lifecycle = requireLifecycle(registry);
      const transition = lifecycle.getTransition(
        request.from_status_id,
        request.to_status_id,
      );

      if (!transition?.approval) {
        await client.query(
          `
            UPDATE civic_registry_transition_requests
            SET
              status = 'cancelled',
              completed_at = $3::timestamptz
            WHERE registry_id = $1
              AND id = $2
          `,
          [
            input.registryId,
            input.requestId,
            now,
          ],
        );
        await client.query("COMMIT");

        throw new PublicationLifecycleError(
          "approval_rule_changed",
          "The approval rule no longer exists; the pending request was cancelled.",
        );
      }

      requireAnyRole(
        actorRoles,
        transition.approval.approverRoles,
        "decide this lifecycle request",
      );

      if (
        request.requester_cannot_approve &&
        request.requested_by === input.actorId
      ) {
        throw new PublicationLifecycleError(
          "requester_cannot_approve",
          "The requester cannot approve their own transition request.",
        );
      }

      let decisionResult;

      try {
        decisionResult =
          await client.query<DecisionRow>(
            `
              INSERT INTO civic_registry_transition_decisions (
                registry_id,
                request_id,
                actor_id,
                decision,
                actor_roles,
                decided_at,
                note
              )
              VALUES (
                $1, $2, $3, $4,
                $5::text[], $6::timestamptz, $7
              )
              RETURNING *
            `,
            [
              input.registryId,
              input.requestId,
              input.actorId,
              input.decision,
              actorRoles,
              now,
              input.note ?? null,
            ],
          );
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new PersistenceConflictError(
            "This actor has already decided this transition request.",
          );
        }

        throw error;
      }

      await insertAuditEvent(client, {
        registryId: input.registryId,
        subjectType: "record",
        subjectId: request.record_id,
        eventType:
          input.decision === "approved"
            ? "lifecycle.transition_approved"
            : "lifecycle.transition_rejected",
        occurredAt: now,
        visibility: "private",
        actorId: input.actorId,
        metadata: {
          requestId: input.requestId,
          fromStatusId: request.from_status_id,
          toStatusId: request.to_status_id,
        },
      });

      if (input.decision === "rejected") {
        const updatedRequest =
          await client.query<RequestRow>(
            `
              UPDATE civic_registry_transition_requests
              SET
                status = 'rejected',
                completed_at = $3::timestamptz
              WHERE registry_id = $1
                AND id = $2
              RETURNING *
            `,
            [
              input.registryId,
              input.requestId,
              now,
            ],
          );

        await client.query("COMMIT");

        return {
          request: mapRequest(
            updatedRequest.rows[0],
          ),
          approvals: 0,
        };
      }

      const approvalCount =
        await client.query<{ count: number }>(
          `
            SELECT COUNT(*)::int AS count
            FROM civic_registry_transition_decisions
            WHERE registry_id = $1
              AND request_id = $2
              AND decision = 'approved'
          `,
          [input.registryId, input.requestId],
        );
      const approvals =
        approvalCount.rows[0]?.count ?? 0;

      if (approvals < request.required_approvals) {
        await client.query("COMMIT");

        return {
          request: mapRequest(request),
          approvals,
        };
      }

      const record = await lockRecord(
        client,
        input.registryId,
        request.record_id,
      );

      if (record.status !== request.from_status_id) {
        const stale =
          await client.query<RequestRow>(
            `
              UPDATE civic_registry_transition_requests
              SET
                status = 'cancelled',
                completed_at = $3::timestamptz
              WHERE registry_id = $1
                AND id = $2
              RETURNING *
            `,
            [
              input.registryId,
              input.requestId,
              now,
            ],
          );
        await client.query("COMMIT");

        return {
          request: mapRequest(stale.rows[0]),
          approvals,
        };
      }

      const recordResult = await applyTransition(
        client,
        registry,
        record,
        request.to_status_id,
        {
          actorId: input.actorId,
          roles: actorRoles,
          reason:
            request.reason ??
            input.note ??
            undefined,
        },
        now,
        {
          keepRequestId: input.requestId,
        },
      );
      const completed =
        await client.query<RequestRow>(
          `
            UPDATE civic_registry_transition_requests
            SET
              status = 'executed',
              completed_at = $3::timestamptz
            WHERE registry_id = $1
              AND id = $2
            RETURNING *
          `,
          [
            input.registryId,
            input.requestId,
            now,
          ],
        );

      await client.query("COMMIT");

      return {
        request: mapRequest(completed.rows[0]),
        record: recordResult,
        approvals,
      };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async schedulePublication(input: {
    registryId: string;
    recordId: string;
    scheduledFor: string;
    context?: LifecycleActorContext;
    now?: string;
  }): Promise<PublicationSchedule> {
    const client = await this.pool.connect();
    const context = {
      ...input.context,
      roles: normalizedRoles(input.context?.roles),
    };
    const now =
      input.now ?? new Date().toISOString();
    const scheduledFor = new Date(
      input.scheduledFor,
    );

    if (
      Number.isNaN(scheduledFor.valueOf()) ||
      scheduledFor.valueOf() <=
        new Date(now).valueOf()
    ) {
      throw new PublicationLifecycleError(
        "invalid_schedule_time",
        "scheduledFor must be a valid future date-time.",
      );
    }

    try {
      await client.query("BEGIN");
      const registry = await loadRegistry(
        client,
        input.registryId,
      );
      const lifecycle = requireLifecycle(registry);
      const schedule =
        lifecycle.definition.scheduledPublication;

      if (!schedule || schedule.enabled === false) {
        throw new PublicationLifecycleError(
          "scheduling_disabled",
          "Scheduled publication is not enabled for this registry.",
        );
      }

      requireAnyRole(
        context.roles,
        schedule.allowedRoles,
        "schedule publication",
      );

      const record = await lockRecord(
        client,
        input.registryId,
        input.recordId,
      );

      if (
        !schedule.fromStatusIds.includes(
          record.status,
        )
      ) {
        throw new PublicationLifecycleError(
          "status_not_schedulable",
          `Status ${record.status} is not eligible for scheduled publication.`,
        );
      }

      const transition = requireTransition(
        lifecycle,
        record.status,
        schedule.targetStatusId,
      );

      if (transition.approval) {
        throw new PublicationLifecycleError(
          "schedule_transition_requires_approval",
          "Scheduled publication cannot execute an approval-gated transition.",
        );
      }

      requireAnyRole(
        context.roles,
        transition.allowedRoles,
        "schedule this lifecycle transition",
      );

      const id = randomUUID();
      let result;

      try {
        result = await client.query<ScheduleRow>(
          `
            INSERT INTO civic_registry_publication_schedules (
              registry_id,
              id,
              record_id,
              from_status_id,
              target_status_id,
              scheduled_for,
              status,
              requested_by,
              requested_roles,
              reason,
              created_at
            )
            VALUES (
              $1, $2, $3, $4, $5,
              $6::timestamptz, 'pending',
              $7, $8::text[], $9,
              $10::timestamptz
            )
            RETURNING *
          `,
          [
            input.registryId,
            id,
            input.recordId,
            record.status,
            schedule.targetStatusId,
            scheduledFor.toISOString(),
            context.actorId ?? null,
            context.roles,
            context.reason ?? null,
            now,
          ],
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new PersistenceConflictError(
            "This record already has a pending publication schedule.",
          );
        }

        throw error;
      }

      await insertAuditEvent(client, {
        registryId: input.registryId,
        subjectType: "record",
        subjectId: input.recordId,
        eventType: "lifecycle.publication_scheduled",
        occurredAt: now,
        visibility: "private",
        actorId: context.actorId,
        reason: context.reason,
        metadata: {
          scheduleId: id,
          fromStatusId: record.status,
          targetStatusId:
            schedule.targetStatusId,
          scheduledFor:
            scheduledFor.toISOString(),
        },
      });

      await client.query("COMMIT");
      return mapSchedule(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async cancelSchedule(input: {
    registryId: string;
    scheduleId: string;
    context?: LifecycleActorContext;
    now?: string;
  }): Promise<PublicationSchedule> {
    const client = await this.pool.connect();
    const context = {
      ...input.context,
      roles: normalizedRoles(input.context?.roles),
    };
    const now =
      input.now ?? new Date().toISOString();

    try {
      await client.query("BEGIN");
      const registry = await loadRegistry(
        client,
        input.registryId,
      );
      const lifecycle = requireLifecycle(registry);
      const scheduleConfig =
        lifecycle.definition.scheduledPublication;

      if (!scheduleConfig) {
        throw new PublicationLifecycleError(
          "scheduling_disabled",
          "Scheduled publication is not configured.",
        );
      }

      requireAnyRole(
        context.roles,
        scheduleConfig.allowedRoles,
        "cancel scheduled publication",
      );

      const current =
        await client.query<ScheduleRow>(
          `
            SELECT *
            FROM civic_registry_publication_schedules
            WHERE registry_id = $1
              AND id = $2
            FOR UPDATE
          `,
          [input.registryId, input.scheduleId],
        );
      const schedule = current.rows[0];

      if (!schedule) {
        throw new PersistenceNotFoundError(
          `Publication schedule ${input.registryId}/${input.scheduleId} does not exist.`,
        );
      }

      if (schedule.status !== "pending") {
        throw new PublicationLifecycleError(
          "schedule_not_pending",
          `Publication schedule is ${schedule.status}, not pending.`,
        );
      }

      const result = await client.query<ScheduleRow>(
        `
          UPDATE civic_registry_publication_schedules
          SET
            status = 'cancelled',
            completed_at = $3::timestamptz
          WHERE registry_id = $1
            AND id = $2
          RETURNING *
        `,
        [
          input.registryId,
          input.scheduleId,
          now,
        ],
      );

      await insertAuditEvent(client, {
        registryId: input.registryId,
        subjectType: "record",
        subjectId: schedule.record_id,
        eventType: "lifecycle.publication_schedule_cancelled",
        occurredAt: now,
        visibility: "private",
        actorId: context.actorId,
        reason: context.reason,
        metadata: {
          scheduleId: schedule.id,
        },
      });

      await client.query("COMMIT");
      return mapSchedule(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getTransitionRequest(
    registryId: string,
    requestId: string,
  ): Promise<TransitionRequest | null> {
    const result = await this.pool.query<RequestRow>(
      `
        SELECT *
        FROM civic_registry_transition_requests
        WHERE registry_id = $1
          AND id = $2
      `,
      [registryId, requestId],
    );

    return result.rows[0]
      ? mapRequest(result.rows[0])
      : null;
  }

  async listTransitionDecisions(
    registryId: string,
    requestId: string,
  ): Promise<TransitionDecision[]> {
    const result = await this.pool.query<DecisionRow>(
      `
        SELECT *
        FROM civic_registry_transition_decisions
        WHERE registry_id = $1
          AND request_id = $2
        ORDER BY decided_at, actor_id
      `,
      [registryId, requestId],
    );

    return result.rows.map(mapDecision);
  }

  async getSchedule(
    registryId: string,
    scheduleId: string,
  ): Promise<PublicationSchedule | null> {
    const result = await this.pool.query<ScheduleRow>(
      `
        SELECT *
        FROM civic_registry_publication_schedules
        WHERE registry_id = $1
          AND id = $2
      `,
      [registryId, scheduleId],
    );

    return result.rows[0]
      ? mapSchedule(result.rows[0])
      : null;
  }

  async processDueSchedules(input: {
    now?: string;
    limit?: number;
  } = {}): Promise<ProcessSchedulesResult> {
    const now =
      input.now ?? new Date().toISOString();
    const limit = Math.max(
      1,
      Math.min(100, Math.trunc(input.limit ?? 25)),
    );
    const due = await this.pool.query<{
      registry_id: string;
      id: string;
    }>(
      `
        SELECT registry_id, id
        FROM civic_registry_publication_schedules
        WHERE status = 'pending'
          AND scheduled_for <= $1::timestamptz
        ORDER BY scheduled_for, registry_id, id
        LIMIT $2
      `,
      [now, limit],
    );

    const result: ProcessSchedulesResult = {
      examined: due.rows.length,
      executed: 0,
      failed: 0,
      skipped: 0,
    };

    for (const candidate of due.rows) {
      const client = await this.pool.connect();

      try {
        await client.query("BEGIN");
        const selected =
          await client.query<ScheduleRow>(
            `
              SELECT *
              FROM civic_registry_publication_schedules
              WHERE registry_id = $1
                AND id = $2
              FOR UPDATE
            `,
            [
              candidate.registry_id,
              candidate.id,
            ],
          );
        const schedule = selected.rows[0];

        if (
          !schedule ||
          schedule.status !== "pending"
        ) {
          result.skipped += 1;
          await client.query("ROLLBACK");
          continue;
        }

        const registry = await loadRegistry(
          client,
          schedule.registry_id,
        );
        const lifecycle = requireLifecycle(registry);
        const scheduleConfig =
          lifecycle.definition.scheduledPublication;
        const record = await lockRecord(
          client,
          schedule.registry_id,
          schedule.record_id,
        );
        let failure: string | undefined;

        if (
          !scheduleConfig ||
          scheduleConfig.enabled === false
        ) {
          failure =
            "Scheduled publication is no longer enabled.";
        } else if (
          record.status !== schedule.from_status_id
        ) {
          failure =
            `Record status changed from ${schedule.from_status_id} to ${record.status} before publication.`;
        } else if (
          scheduleConfig.targetStatusId !==
          schedule.target_status_id
        ) {
          failure =
            "The configured scheduled-publication target changed.";
        } else if (
          !scheduleConfig.fromStatusIds.includes(
            record.status,
          )
        ) {
          failure =
            `Status ${record.status} is no longer schedulable.`;
        } else {
          const transition =
            lifecycle.getTransition(
              record.status,
              schedule.target_status_id,
            );

          if (!transition) {
            failure =
              "The configured publication transition no longer exists.";
          } else if (transition.approval) {
            failure =
              "The scheduled publication transition now requires approval.";
          } else if (
            transition.allowedRoles?.length &&
            !transition.allowedRoles.some((role) =>
              schedule.requested_roles.includes(role),
            )
          ) {
            failure =
              "The original scheduler no longer satisfies the configured transition permission.";
          }
        }

        if (failure) {
          await client.query(
            `
              UPDATE civic_registry_publication_schedules
              SET
                status = 'failed',
                completed_at = $3::timestamptz,
                failure_reason = $4
              WHERE registry_id = $1
                AND id = $2
            `,
            [
              schedule.registry_id,
              schedule.id,
              now,
              failure,
            ],
          );
          await insertAuditEvent(client, {
            registryId: schedule.registry_id,
            subjectType: "record",
            subjectId: schedule.record_id,
            eventType:
              "lifecycle.publication_schedule_failed",
            occurredAt: now,
            visibility: "private",
            actorId:
              "system:publication-scheduler",
            reason: failure,
            metadata: {
              scheduleId: schedule.id,
            },
          });
          await client.query("COMMIT");
          result.failed += 1;
          continue;
        }

        await applyTransition(
          client,
          registry,
          record,
          schedule.target_status_id,
          {
            actorId:
              "system:publication-scheduler",
            roles: [],
            reason:
              schedule.reason ??
              "Scheduled publication.",
          },
          now,
          {
            keepScheduleId: schedule.id,
          },
        );
        await client.query(
          `
            UPDATE civic_registry_publication_schedules
            SET
              status = 'executed',
              completed_at = $3::timestamptz
            WHERE registry_id = $1
              AND id = $2
          `,
          [
            schedule.registry_id,
            schedule.id,
            now,
          ],
        );
        await insertAuditEvent(client, {
          registryId: schedule.registry_id,
          subjectType: "record",
          subjectId: schedule.record_id,
          eventType:
            "lifecycle.publication_schedule_executed",
          occurredAt: now,
          visibility: "private",
          actorId:
            "system:publication-scheduler",
          metadata: {
            scheduleId: schedule.id,
            targetStatusId:
              schedule.target_status_id,
          },
        });

        await client.query("COMMIT");
        result.executed += 1;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {}
        throw error;
      } finally {
        client.release();
      }
    }

    return result;
  }
}
