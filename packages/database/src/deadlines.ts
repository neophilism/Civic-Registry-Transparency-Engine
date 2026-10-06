import { randomUUID } from "node:crypto";

import {
  compileRegistryConfig,
  type CompiledRegistryConfig,
  type DeadlineDefinitionConfig,
  type RegistryConfigFile,
} from "@civic-registry/config";
import type {
  DeadlineInstance,
  DeadlineState,
  RegistryRecord,
} from "@civic-registry/core";
import {
  calculateDeadlineDueAt,
  deadlineAppliesToRecord,
  normalizeDeadlineAnchor,
} from "@civic-registry/deadlines";
import type {
  Pool,
  PoolClient,
  QueryResultRow,
} from "pg";

export interface DeadlineActorContext {
  actorId?: string;
  reason?: string;
}

export interface DeadlineReconcileResult {
  registryId: string;
  recordId: string;
  created: number;
  updated: number;
  unchanged: number;
}

export interface DeadlineListOptions {
  states?: DeadlineState[];
  dueBefore?: string;
  dueAfter?: string;
  limit?: number;
  offset?: number;
}

export interface ManualDeadlineInput {
  registryId: string;
  recordId: string;
  deadlineTypeId: string;
  instanceKey?: string;
  anchorAt: string;
  now?: string;
  context?: DeadlineActorContext;
  metadata?: DeadlineInstance["metadata"];
}

export interface DeadlineReconciler {
  reconcileRecord(
    registryId: string,
    recordId: string,
    options?: {
      now?: string;
      context?: DeadlineActorContext;
    },
  ): Promise<DeadlineReconcileResult>;
  reconcileRecordWithClient(
    client: PoolClient,
    registryId: string,
    recordId: string,
    options?: {
      now?: string;
      context?: DeadlineActorContext;
    },
  ): Promise<DeadlineReconcileResult>;
}

export class DeadlineEngineError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DeadlineEngineError";
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
    totalPausedSeconds: Number(
      row.total_paused_seconds,
    ),
    completedAt: row.completed_at?.toISOString(),
    cancelledAt: row.cancelled_at?.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    metadata: row.metadata ?? {},
  };
}

function validDateTime(
  value: string,
  label: string,
): string {
  const date = new Date(value);

  if (Number.isNaN(date.valueOf())) {
    throw new DeadlineEngineError(
      "invalid_datetime",
      `${label} must be a valid date-time.`,
    );
  }

  return date.toISOString();
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return 100;
  return Math.max(1, Math.min(Math.trunc(limit), 500));
}

function normalizeOffset(offset: number | undefined): number {
  if (offset === undefined) return 0;
  return Math.max(0, Math.trunc(offset));
}

function addSeconds(
  value: string,
  seconds: number,
): string {
  const date = new Date(value);
  date.setTime(
    date.valueOf() + seconds * 1000,
  );
  return date.toISOString();
}

function pausedSeconds(
  pausedAt: string,
  now: string,
): number {
  return Math.max(
    0,
    Math.floor(
      (new Date(now).valueOf() -
        new Date(pausedAt).valueOf()) /
        1000,
    ),
  );
}

async function setAuditContext(
  client: PoolClient,
  context: DeadlineActorContext | undefined,
): Promise<void> {
  await client.query(
    `
      SELECT
        set_config(
          'civic_registry.actor_id',
          $1,
          true
        ),
        set_config(
          'civic_registry.reason',
          $2,
          true
        )
    `,
    [
      context?.actorId ?? "",
      context?.reason ?? "",
    ],
  );
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
    throw new DeadlineEngineError(
      "registry_not_found",
      `Registry configuration ${registryId} does not exist.`,
    );
  }

  return compileRegistryConfig(config);
}

async function loadRecord(
  client: PoolClient,
  registryId: string,
  recordId: string,
  lock = false,
): Promise<RecordRow> {
  const result = await client.query<RecordRow>(
    `
      SELECT *
      FROM civic_registry_records
      WHERE registry_id = $1
        AND id = $2
      ${lock ? "FOR UPDATE" : ""}
    `,
    [registryId, recordId],
  );

  const record = result.rows[0];

  if (!record) {
    throw new DeadlineEngineError(
      "record_not_found",
      `Record ${registryId}/${recordId} does not exist.`,
    );
  }

  return record;
}

function statusDirective(
  definition: DeadlineDefinitionConfig,
  status: string,
):
  | "cancel"
  | "complete"
  | "pause"
  | "open" {
  if (
    definition.cancelWhenStatuses?.includes(
      status,
    )
  ) {
    return "cancel";
  }

  if (
    definition.completeWhenStatuses?.includes(
      status,
    )
  ) {
    return "complete";
  }

  if (
    definition.pauseWhileStatuses?.includes(
      status,
    )
  ) {
    return "pause";
  }

  return "open";
}

async function resolveStatusEnteredAnchor(
  client: PoolClient,
  record: RecordRow,
  statusId: string,
): Promise<string | null> {
  const result = await client.query<{
    occurred_at: Date;
  }>(
    `
      SELECT occurred_at
      FROM civic_registry_audit_events
      WHERE registry_id = $1
        AND subject_type = 'record'
        AND subject_id = $2
        AND (
          (
            event_type =
              'lifecycle.transition_executed'
            AND metadata ->> 'toStatusId' = $3
          )
          OR (
            event_type IN (
              'record.status_changed',
              'record.published',
              'record.withdrawn'
            )
            AND metadata ->> 'toStatus' = $3
          )
        )
      ORDER BY occurred_at DESC, id DESC
      LIMIT 1
    `,
    [
      record.registry_id,
      record.id,
      statusId,
    ],
  );

  if (result.rows[0]) {
    return result.rows[0].occurred_at.toISOString();
  }

  if (record.status === statusId) {
    return record.created_at.toISOString();
  }

  return null;
}

async function resolveAnchor(
  client: PoolClient,
  registry: CompiledRegistryConfig,
  record: RecordRow,
  definition: DeadlineDefinitionConfig,
): Promise<string | null> {
  switch (definition.anchor.kind) {
    case "createdAt":
      return record.created_at.toISOString();
    case "publishedAt":
      return record.published_at?.toISOString() ?? null;
    case "statusEntered":
      return resolveStatusEnteredAnchor(
        client,
        record,
        definition.anchor.statusId,
      );
    case "manual":
      return null;
    case "field": {
      const value =
        record.fields[definition.anchor.fieldId];

      if (
        typeof value !== "string" ||
        value.trim().length === 0
      ) {
        return null;
      }

      const field = registry
        .getRecordType(record.record_type_id)
        .fieldsById.get(
          definition.anchor.fieldId,
        );

      return normalizeDeadlineAnchor(value, {
        dateOnlyAnchorTime:
          field?.type === "date"
            ? definition.dateOnlyAnchorTime ??
              "end"
            : undefined,
      });
    }
  }
}

function initialStateFields(
  directive:
    | "cancel"
    | "complete"
    | "pause"
    | "open",
  now: string,
): {
  state: DeadlineState;
  pausedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
} {
  switch (directive) {
    case "cancel":
      return {
        state: "cancelled",
        pausedAt: null,
        completedAt: null,
        cancelledAt: now,
      };
    case "complete":
      return {
        state: "completed",
        pausedAt: null,
        completedAt: now,
        cancelledAt: null,
      };
    case "pause":
      return {
        state: "paused",
        pausedAt: now,
        completedAt: null,
        cancelledAt: null,
      };
    case "open":
      return {
        state: "open",
        pausedAt: null,
        completedAt: null,
        cancelledAt: null,
      };
  }
}

export class PostgresDeadlineService
  implements DeadlineReconciler
{
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async get(
    registryId: string,
    deadlineId: string,
  ): Promise<DeadlineInstance | null> {
    const result = await this.pool.query<DeadlineRow>(
      `
        SELECT *
        FROM civic_registry_deadlines
        WHERE registry_id = $1
          AND id = $2
      `,
      [registryId, deadlineId],
    );

    return result.rows[0]
      ? mapDeadline(result.rows[0])
      : null;
  }

  async listForRecord(
    registryId: string,
    recordId: string,
    options: DeadlineListOptions = {},
  ): Promise<DeadlineInstance[]> {
    const values: unknown[] = [
      registryId,
      recordId,
    ];
    const where = [
      "registry_id = $1",
      "record_id = $2",
    ];

    const states = [
      ...new Set(
        (options.states ?? [])
          .map((value) => value.trim())
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
      values.push(
        validDateTime(
          options.dueBefore,
          "dueBefore",
        ),
      );
      where.push(
        `due_at <= $${values.length}::timestamptz`,
      );
    }

    if (options.dueAfter) {
      values.push(
        validDateTime(
          options.dueAfter,
          "dueAfter",
        ),
      );
      where.push(
        `due_at >= $${values.length}::timestamptz`,
      );
    }

    const limit = clampLimit(options.limit);
    const offset = normalizeOffset(options.offset);

    const result = await this.pool.query<DeadlineRow>(
      `
        SELECT *
        FROM civic_registry_deadlines
        WHERE ${where.join(" AND ")}
        ORDER BY due_at ASC, id ASC
        LIMIT ${limit}
        OFFSET ${offset}
      `,
      values,
    );

    return result.rows.map(mapDeadline);
  }

  async reconcileRecord(
    registryId: string,
    recordId: string,
    options: {
      now?: string;
      context?: DeadlineActorContext;
    } = {},
  ): Promise<DeadlineReconcileResult> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const result =
        await this.reconcileRecordWithClient(
          client,
          registryId,
          recordId,
          options,
        );
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async reconcileRecordWithClient(
    client: PoolClient,
    registryId: string,
    recordId: string,
    options: {
      now?: string;
      context?: DeadlineActorContext;
    } = {},
  ): Promise<DeadlineReconcileResult> {
    const now = validDateTime(
      options.now ?? new Date().toISOString(),
      "now",
    );
    await setAuditContext(
      client,
      options.context,
    );
    const registry = await loadRegistry(
      client,
      registryId,
    );
    const record = await loadRecord(
      client,
      registryId,
      recordId,
      true,
    );
    const definitions =
      registry.deadlines?.definition.definitions ?? [];

    let created = 0;
    let updated = 0;
    let unchanged = 0;

    for (const definition of definitions) {
      if (
        definition.anchor.kind === "manual" ||
        !deadlineAppliesToRecord(
          definition,
          record.record_type_id,
        )
      ) {
        continue;
      }

      const anchorAt = await resolveAnchor(
        client,
        registry,
        record,
        definition,
      );

      if (!anchorAt) {
        unchanged += 1;
        continue;
      }

      const existingResult =
        await client.query<DeadlineRow>(
          `
            SELECT *
            FROM civic_registry_deadlines
            WHERE registry_id = $1
              AND record_id = $2
              AND deadline_type_id = $3
              AND instance_key = 'automatic'
            FOR UPDATE
          `,
          [
            registryId,
            recordId,
            definition.id,
          ],
        );
      const existing = existingResult.rows[0];
      const calendar =
        registry.deadlines!.getCalendar(
          definition.calendarId,
        );
      const normalizedAnchor =
        validDateTime(anchorAt, "anchorAt");
      const baseDueAt = calculateDeadlineDueAt(
        normalizedAnchor,
        definition,
        calendar,
      );
      const directive = statusDirective(
        definition,
        record.status,
      );

      if (!existing) {
        const state = initialStateFields(
          directive,
          now,
        );

        await client.query(
          `
            INSERT INTO civic_registry_deadlines (
              registry_id,
              id,
              record_id,
              deadline_type_id,
              instance_key,
              anchor_at,
              due_at,
              state,
              paused_at,
              total_paused_seconds,
              completed_at,
              cancelled_at,
              created_at,
              updated_at,
              metadata
            )
            VALUES (
              $1, $2, $3, $4, 'automatic',
              $5::timestamptz, $6::timestamptz,
              $7, $8::timestamptz, 0,
              $9::timestamptz, $10::timestamptz,
              $11::timestamptz, $11::timestamptz,
              '{}'::jsonb
            )
          `,
          [
            registryId,
            randomUUID(),
            recordId,
            definition.id,
            normalizedAnchor,
            baseDueAt,
            state.state,
            state.pausedAt,
            state.completedAt,
            state.cancelledAt,
            now,
          ],
        );
        created += 1;
        continue;
      }

      if (
        existing.state === "completed" ||
        existing.state === "cancelled"
      ) {
        unchanged += 1;
        continue;
      }

      let totalPausedSeconds = Number(
        existing.total_paused_seconds,
      );
      let state: DeadlineState = existing.state;
      let pausedAt =
        existing.paused_at?.toISOString() ?? null;
      let completedAt: string | null = null;
      let cancelledAt: string | null = null;

      if (directive === "cancel") {
        state = "cancelled";
        pausedAt = null;
        cancelledAt = now;
      } else if (directive === "complete") {
        state = "completed";
        pausedAt = null;
        completedAt = now;
      } else if (directive === "pause") {
        if (existing.state === "open") {
          state = "paused";
          pausedAt = now;
        }
      } else if (
        existing.state === "paused" &&
        pausedAt
      ) {
        totalPausedSeconds += pausedSeconds(
          pausedAt,
          now,
        );
        state = "open";
        pausedAt = null;
      }

      const dueAt = addSeconds(
        baseDueAt,
        totalPausedSeconds,
      );
      const changed =
        existing.anchor_at.toISOString() !==
          normalizedAnchor ||
        existing.due_at.toISOString() !== dueAt ||
        existing.state !== state ||
        (existing.paused_at?.toISOString() ?? null) !==
          pausedAt ||
        Number(existing.total_paused_seconds) !==
          totalPausedSeconds ||
        (existing.completed_at?.toISOString() ?? null) !==
          completedAt ||
        (existing.cancelled_at?.toISOString() ?? null) !==
          cancelledAt;

      if (!changed) {
        unchanged += 1;
        continue;
      }

      await client.query(
        `
          UPDATE civic_registry_deadlines
          SET
            anchor_at = $5::timestamptz,
            due_at = $6::timestamptz,
            state = $7,
            paused_at = $8::timestamptz,
            total_paused_seconds = $9,
            completed_at = $10::timestamptz,
            cancelled_at = $11::timestamptz,
            updated_at = $12::timestamptz
          WHERE registry_id = $1
            AND record_id = $2
            AND deadline_type_id = $3
            AND instance_key = $4
        `,
        [
          registryId,
          recordId,
          definition.id,
          "automatic",
          normalizedAnchor,
          dueAt,
          state,
          pausedAt,
          totalPausedSeconds,
          completedAt,
          cancelledAt,
          now,
        ],
      );
      updated += 1;
    }

    return {
      registryId,
      recordId,
      created,
      updated,
      unchanged,
    };
  }

  async reconcileRegistry(
    registryId: string,
    options: {
      now?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<{
    records: number;
    created: number;
    updated: number;
    unchanged: number;
  }> {
    const result = await this.pool.query<{
      id: string;
    }>(
      `
        SELECT id
        FROM civic_registry_records
        WHERE registry_id = $1
        ORDER BY id
        LIMIT $2
        OFFSET $3
      `,
      [
        registryId,
        clampLimit(options.limit ?? 500),
        normalizeOffset(options.offset),
      ],
    );
    let created = 0;
    let updated = 0;
    let unchanged = 0;

    for (const row of result.rows) {
      const reconciled =
        await this.reconcileRecord(
          registryId,
          row.id,
          {
            now: options.now,
          },
        );
      created += reconciled.created;
      updated += reconciled.updated;
      unchanged += reconciled.unchanged;
    }

    return {
      records: result.rows.length,
      created,
      updated,
      unchanged,
    };
  }

  async createManual(
    input: ManualDeadlineInput,
  ): Promise<DeadlineInstance> {
    const client = await this.pool.connect();
    const now = validDateTime(
      input.now ?? new Date().toISOString(),
      "now",
    );

    try {
      await client.query("BEGIN");
      await setAuditContext(
        client,
        input.context,
      );
      const registry = await loadRegistry(
        client,
        input.registryId,
      );
      const definition =
        registry.deadlines?.getDefinition(
          input.deadlineTypeId,
        );

      if (!definition) {
        throw new DeadlineEngineError(
          "deadline_type_not_found",
          `Deadline type ${input.deadlineTypeId} is not configured.`,
        );
      }

      if (definition.anchor.kind !== "manual") {
        throw new DeadlineEngineError(
          "deadline_not_manual",
          `Deadline type ${definition.id} is not configured for manual creation.`,
        );
      }

      const record = await loadRecord(
        client,
        input.registryId,
        input.recordId,
        true,
      );

      if (
        !deadlineAppliesToRecord(
          definition,
          record.record_type_id,
        )
      ) {
        throw new DeadlineEngineError(
          "deadline_record_type_mismatch",
          `Deadline type ${definition.id} does not apply to record type ${record.record_type_id}.`,
        );
      }

      const anchorAt = normalizeDeadlineAnchor(
        input.anchorAt,
        {
          dateOnlyAnchorTime:
            definition.dateOnlyAnchorTime ??
            "end",
        },
      );
      const dueAt = calculateDeadlineDueAt(
        anchorAt,
        definition,
        registry.deadlines!.getCalendar(
          definition.calendarId,
        ),
      );
      const directive = statusDirective(
        definition,
        record.status,
      );
      const state = initialStateFields(
        directive,
        now,
      );
      const instanceKey =
        input.instanceKey?.trim() ||
        randomUUID();

      const result = await client.query<DeadlineRow>(
        `
          INSERT INTO civic_registry_deadlines (
            registry_id,
            id,
            record_id,
            deadline_type_id,
            instance_key,
            anchor_at,
            due_at,
            state,
            paused_at,
            total_paused_seconds,
            completed_at,
            cancelled_at,
            created_at,
            updated_at,
            metadata
          )
          VALUES (
            $1, $2, $3, $4, $5,
            $6::timestamptz, $7::timestamptz,
            $8, $9::timestamptz, 0,
            $10::timestamptz, $11::timestamptz,
            $12::timestamptz, $12::timestamptz,
            $13::jsonb
          )
          RETURNING *
        `,
        [
          input.registryId,
          randomUUID(),
          input.recordId,
          definition.id,
          instanceKey,
          anchorAt,
          dueAt,
          state.state,
          state.pausedAt,
          state.completedAt,
          state.cancelledAt,
          now,
          JSON.stringify(input.metadata ?? {}),
        ],
      );

      await client.query("COMMIT");
      return mapDeadline(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async pause(
    registryId: string,
    deadlineId: string,
    input: {
      now?: string;
      context?: DeadlineActorContext;
    } = {},
  ): Promise<DeadlineInstance> {
    return this.transitionState(
      registryId,
      deadlineId,
      "pause",
      input,
    );
  }

  async resume(
    registryId: string,
    deadlineId: string,
    input: {
      now?: string;
      context?: DeadlineActorContext;
    } = {},
  ): Promise<DeadlineInstance> {
    return this.transitionState(
      registryId,
      deadlineId,
      "resume",
      input,
    );
  }

  async complete(
    registryId: string,
    deadlineId: string,
    input: {
      now?: string;
      context?: DeadlineActorContext;
    } = {},
  ): Promise<DeadlineInstance> {
    return this.transitionState(
      registryId,
      deadlineId,
      "complete",
      input,
    );
  }

  async cancel(
    registryId: string,
    deadlineId: string,
    input: {
      now?: string;
      context?: DeadlineActorContext;
    } = {},
  ): Promise<DeadlineInstance> {
    return this.transitionState(
      registryId,
      deadlineId,
      "cancel",
      input,
    );
  }

  private async transitionState(
    registryId: string,
    deadlineId: string,
    action:
      | "pause"
      | "resume"
      | "complete"
      | "cancel",
    input: {
      now?: string;
      context?: DeadlineActorContext;
    },
  ): Promise<DeadlineInstance> {
    const client = await this.pool.connect();
    const now = validDateTime(
      input.now ?? new Date().toISOString(),
      "now",
    );

    try {
      await client.query("BEGIN");
      await setAuditContext(
        client,
        input.context,
      );
      const result = await client.query<DeadlineRow>(
        `
          SELECT *
          FROM civic_registry_deadlines
          WHERE registry_id = $1
            AND id = $2
          FOR UPDATE
        `,
        [registryId, deadlineId],
      );
      const row = result.rows[0];

      if (!row) {
        throw new DeadlineEngineError(
          "deadline_not_found",
          `Deadline ${registryId}/${deadlineId} does not exist.`,
        );
      }

      if (
        row.state === "completed" ||
        row.state === "cancelled"
      ) {
        throw new DeadlineEngineError(
          "deadline_terminal",
          `Deadline ${deadlineId} is already ${row.state}.`,
        );
      }

      let state: DeadlineState = row.state;
      let pausedAt =
        row.paused_at?.toISOString() ?? null;
      let totalPausedSeconds = Number(
        row.total_paused_seconds,
      );
      let dueAt = row.due_at.toISOString();
      let completedAt: string | null = null;
      let cancelledAt: string | null = null;

      if (action === "pause") {
        if (state !== "open") {
          throw new DeadlineEngineError(
            "deadline_not_open",
            "Only an open deadline can be paused.",
          );
        }
        state = "paused";
        pausedAt = now;
      } else if (action === "resume") {
        if (state !== "paused" || !pausedAt) {
          throw new DeadlineEngineError(
            "deadline_not_paused",
            "Only a paused deadline can be resumed.",
          );
        }
        const seconds = pausedSeconds(
          pausedAt,
          now,
        );
        totalPausedSeconds += seconds;
        dueAt = addSeconds(dueAt, seconds);
        state = "open";
        pausedAt = null;
      } else if (action === "complete") {
        state = "completed";
        pausedAt = null;
        completedAt = now;
      } else {
        state = "cancelled";
        pausedAt = null;
        cancelledAt = now;
      }

      const updated = await client.query<DeadlineRow>(
        `
          UPDATE civic_registry_deadlines
          SET
            due_at = $3::timestamptz,
            state = $4,
            paused_at = $5::timestamptz,
            total_paused_seconds = $6,
            completed_at = $7::timestamptz,
            cancelled_at = $8::timestamptz,
            updated_at = $9::timestamptz
          WHERE registry_id = $1
            AND id = $2
          RETURNING *
        `,
        [
          registryId,
          deadlineId,
          dueAt,
          state,
          pausedAt,
          totalPausedSeconds,
          completedAt,
          cancelledAt,
          now,
        ],
      );

      await client.query("COMMIT");
      return mapDeadline(updated.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
