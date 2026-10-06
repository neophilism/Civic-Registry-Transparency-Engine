import { randomUUID } from "node:crypto";

import {
  compileRegistryConfig,
  type CompiledRegistryConfig,
} from "@civic-registry/config";
import type {
  JsonFieldValue,
  RegistryRecord,
} from "@civic-registry/core";
import {
  compileIngestionProfile,
  decodeIngestionInput,
  mapIngestionRow,
  sha256Fingerprint,
  stableStringify,
  type CompiledRecordIngestionProfile,
  type IngestionFormat,
  type IngestionIssue,
  type RecordIngestionProfile,
} from "@civic-registry/ingestion";
import type {
  Pool,
  QueryResultRow,
} from "pg";

import {
  PostgresDeadlineService,
} from "./deadlines.ts";
import {
  PersistenceConflictError,
  PersistenceNotFoundError,
  PostgresRecordRepository,
  PostgresRegistryConfigRepository,
} from "./repositories.ts";

export type IngestionRunStatus =
  | "running"
  | "completed"
  | "completed_with_errors"
  | "failed";

export type IngestionItemOutcome =
  | "created"
  | "updated"
  | "unchanged"
  | "validated"
  | "failed";

export interface IngestionRun {
  id: string;
  registryId: string;
  profileId: string;
  profile: CompiledRecordIngestionProfile;
  inputFormat: IngestionFormat;
  mode: "create" | "upsert";
  sourceLabel: string;
  sourceUri?: string;
  inputSha256: string;
  dryRun: boolean;
  status: IngestionRunStatus;
  totalItems: number;
  createdItems: number;
  updatedItems: number;
  unchangedItems: number;
  validatedItems: number;
  failedItems: number;
  startedAt: string;
  completedAt?: string;
  actorId?: string;
  reason?: string;
  metadata: Record<string, JsonFieldValue>;
}

export interface IngestionItem {
  id: string;
  registryId: string;
  runId: string;
  itemIndex?: number;
  lineNumber?: number;
  sourceKey?: string;
  recordId?: string;
  inputFingerprint?: string;
  outcome: IngestionItemOutcome;
  errorCode?: string;
  errorMessage?: string;
  errorDetails: IngestionIssue[];
  processedAt: string;
}

export interface RunIngestionInput {
  registryId: string;
  profile: RecordIngestionProfile;
  format: IngestionFormat;
  input: string;
  sourceLabel: string;
  sourceUri?: string;
  csvDelimiter?: string;
  dryRun?: boolean;
  actorId?: string;
  reason?: string;
  now?: string;
  metadata?: Record<string, JsonFieldValue>;
}

export interface IngestionRunResult {
  run: IngestionRun;
}

interface RunRow extends QueryResultRow {
  registry_id: string;
  id: string;
  profile_id: string;
  profile: CompiledRecordIngestionProfile;
  input_format: IngestionFormat;
  ingestion_mode: "create" | "upsert";
  source_label: string;
  source_uri: string | null;
  input_sha256: string;
  dry_run: boolean;
  status: IngestionRunStatus;
  total_items: number;
  created_items: number;
  updated_items: number;
  unchanged_items: number;
  validated_items: number;
  failed_items: number;
  started_at: Date;
  completed_at: Date | null;
  actor_id: string | null;
  reason: string | null;
  metadata: Record<string, JsonFieldValue>;
}

interface ItemRow extends QueryResultRow {
  id: string | number;
  registry_id: string;
  run_id: string;
  item_index: number | null;
  line_number: number | null;
  source_key: string | null;
  record_id: string | null;
  input_fingerprint: string | null;
  outcome: IngestionItemOutcome;
  error_code: string | null;
  error_message: string | null;
  error_details: IngestionIssue[];
  processed_at: Date;
}

interface MutableCounts {
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  validated: number;
  failed: number;
}

function mapRun(row: RunRow): IngestionRun {
  return {
    id: row.id,
    registryId: row.registry_id,
    profileId: row.profile_id,
    profile: row.profile,
    inputFormat: row.input_format,
    mode: row.ingestion_mode,
    sourceLabel: row.source_label,
    sourceUri: row.source_uri ?? undefined,
    inputSha256: row.input_sha256,
    dryRun: row.dry_run,
    status: row.status,
    totalItems: row.total_items,
    createdItems: row.created_items,
    updatedItems: row.updated_items,
    unchangedItems: row.unchanged_items,
    validatedItems: row.validated_items,
    failedItems: row.failed_items,
    startedAt: row.started_at.toISOString(),
    completedAt:
      row.completed_at?.toISOString(),
    actorId: row.actor_id ?? undefined,
    reason: row.reason ?? undefined,
    metadata: row.metadata ?? {},
  };
}

function mapItem(row: ItemRow): IngestionItem {
  return {
    id: String(row.id),
    registryId: row.registry_id,
    runId: row.run_id,
    itemIndex: row.item_index ?? undefined,
    lineNumber: row.line_number ?? undefined,
    sourceKey: row.source_key ?? undefined,
    recordId: row.record_id ?? undefined,
    inputFingerprint:
      row.input_fingerprint ?? undefined,
    outcome: row.outcome,
    errorCode: row.error_code ?? undefined,
    errorMessage:
      row.error_message ?? undefined,
    errorDetails: row.error_details ?? [],
    processedAt:
      row.processed_at.toISOString(),
  };
}

function validDateTime(
  value: string,
  label: string,
): string {
  const date = new Date(value);

  if (Number.isNaN(date.valueOf())) {
    throw new Error(
      `${label} must be a valid date-time.`,
    );
  }

  return date.toISOString();
}

function requireNonEmpty(
  value: string,
  label: string,
): string {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error(
      `${label} must be a non-empty string.`,
    );
  }

  return trimmed;
}

function comparableRecord(
  record: RegistryRecord,
): unknown {
  return {
    recordTypeId: record.recordTypeId,
    fields: record.fields,
    status: record.status,
    visibility: record.visibility,
    externalIdentifiers:
      record.externalIdentifiers ?? [],
    tags: record.tags ?? [],
    publishedAt: record.publishedAt ?? null,
  };
}

function recordsEquivalent(
  left: RegistryRecord,
  right: RegistryRecord,
): boolean {
  return (
    stableStringify(comparableRecord(left)) ===
    stableStringify(comparableRecord(right))
  );
}

function failureFromError(
  error: unknown,
): {
  code: string;
  message: string;
  details: IngestionIssue[];
} {
  if (error instanceof PersistenceConflictError) {
    return {
      code: "persistence_conflict",
      message: error.message,
      details: [
        {
          code: "persistence_conflict",
          message: error.message,
        },
      ],
    };
  }

  if (error instanceof PersistenceNotFoundError) {
    return {
      code: "persistence_not_found",
      message: error.message,
      details: [
        {
          code: "persistence_not_found",
          message: error.message,
        },
      ],
    };
  }

  const message =
    error instanceof Error
      ? error.message
      : "Unknown ingestion persistence error.";

  return {
    code: "ingestion_persistence_error",
    message,
    details: [
      {
        code: "ingestion_persistence_error",
        message,
      },
    ],
  };
}

function candidateForExisting(
  existing: RegistryRecord,
  mapped: RegistryRecord,
  profile: CompiledRecordIngestionProfile,
  now: string,
): RegistryRecord {
  const managesTags =
    profile.tags !== undefined ||
    profile.staticTags.length > 0;
  const managesExternalIdentifiers =
    (profile.externalIdentifiers?.length ??
      0) > 0;

  return {
    ...mapped,
    createdAt: existing.createdAt,
    fields: profile.replaceFields
      ? mapped.fields
      : {
          ...existing.fields,
          ...mapped.fields,
        },
    status:
      profile.status !== undefined
        ? mapped.status
        : existing.status,
    visibility:
      profile.visibility !== undefined
        ? mapped.visibility
        : existing.visibility,
    tags: managesTags
      ? mapped.tags
      : existing.tags,
    externalIdentifiers:
      managesExternalIdentifiers
        ? mapped.externalIdentifiers
        : existing.externalIdentifiers,
    publishedAt:
      profile.publishedAt !== undefined
        ? mapped.publishedAt
        : existing.publishedAt,
    updatedAt:
      profile.updatedAt !== undefined
        ? mapped.updatedAt
        : now,
  };
}

export class PostgresIngestionService {
  private readonly pool: Pool;
  private readonly configs: PostgresRegistryConfigRepository;
  private readonly records: PostgresRecordRepository;

  constructor(pool: Pool) {
    this.pool = pool;
    this.configs =
      new PostgresRegistryConfigRepository(pool);
    const deadlines =
      new PostgresDeadlineService(pool);
    this.records = new PostgresRecordRepository(
      pool,
      this.configs,
      deadlines,
    );
  }

  async getRun(
    registryId: string,
    runId: string,
  ): Promise<IngestionRun | null> {
    const result = await this.pool.query<RunRow>(
      `
        SELECT *
        FROM civic_registry_ingestion_runs
        WHERE registry_id = $1
          AND id = $2
      `,
      [registryId, runId],
    );

    return result.rows[0]
      ? mapRun(result.rows[0])
      : null;
  }

  async listRuns(
    registryId: string,
    options: {
      profileId?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<IngestionRun[]> {
    const values: unknown[] = [registryId];
    const where = ["registry_id = $1"];

    if (options.profileId) {
      values.push(options.profileId);
      where.push(
        `profile_id = $${values.length}`,
      );
    }

    const limit = Math.max(
      1,
      Math.min(
        Math.trunc(options.limit ?? 100),
        500,
      ),
    );
    const offset = Math.max(
      0,
      Math.trunc(options.offset ?? 0),
    );

    const result = await this.pool.query<RunRow>(
      `
        SELECT *
        FROM civic_registry_ingestion_runs
        WHERE ${where.join(" AND ")}
        ORDER BY started_at DESC, id DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `,
      values,
    );

    return result.rows.map(mapRun);
  }

  async listItems(
    registryId: string,
    runId: string,
    options: {
      outcome?: IngestionItemOutcome;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<IngestionItem[]> {
    const values: unknown[] = [
      registryId,
      runId,
    ];
    const where = [
      "registry_id = $1",
      "run_id = $2",
    ];

    if (options.outcome) {
      values.push(options.outcome);
      where.push(
        `outcome = $${values.length}`,
      );
    }

    const limit = Math.max(
      1,
      Math.min(
        Math.trunc(options.limit ?? 100),
        500,
      ),
    );
    const offset = Math.max(
      0,
      Math.trunc(options.offset ?? 0),
    );

    const result = await this.pool.query<ItemRow>(
      `
        SELECT *
        FROM civic_registry_ingestion_items
        WHERE ${where.join(" AND ")}
        ORDER BY
          item_index ASC NULLS LAST,
          id ASC
        LIMIT ${limit}
        OFFSET ${offset}
      `,
      values,
    );

    return result.rows.map(mapItem);
  }

  private async insertItem(input: {
    registryId: string;
    runId: string;
    itemIndex?: number;
    lineNumber?: number;
    sourceKey?: string;
    recordId?: string;
    inputFingerprint?: string;
    outcome: IngestionItemOutcome;
    errorCode?: string;
    errorMessage?: string;
    errorDetails?: IngestionIssue[];
    processedAt: string;
  }): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO civic_registry_ingestion_items (
          registry_id,
          run_id,
          item_index,
          line_number,
          source_key,
          record_id,
          input_fingerprint,
          outcome,
          error_code,
          error_message,
          error_details,
          processed_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11::jsonb,
          $12::timestamptz
        )
      `,
      [
        input.registryId,
        input.runId,
        input.itemIndex ?? null,
        input.lineNumber ?? null,
        input.sourceKey ?? null,
        input.recordId ?? null,
        input.inputFingerprint ?? null,
        input.outcome,
        input.errorCode ?? null,
        input.errorMessage ?? null,
        JSON.stringify(
          input.errorDetails ?? [],
        ),
        input.processedAt,
      ],
    );
  }

  private async insertRecordAudit(input: {
    registryId: string;
    recordId: string;
    runId: string;
    profileId: string;
    sourceKey: string;
    inputFingerprint: string;
    outcome: Exclude<
      IngestionItemOutcome,
      "validated" | "failed"
    >;
    occurredAt: string;
    actorId?: string;
    reason?: string;
  }): Promise<void> {
    await this.pool.query(
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
          $1,
          'record',
          $2,
          $3,
          $4::timestamptz,
          'private',
          $5,
          $6,
          $7::jsonb
        )
      `,
      [
        input.registryId,
        input.recordId,
        `ingestion.record_${input.outcome}`,
        input.occurredAt,
        input.actorId ?? null,
        input.reason ?? null,
        JSON.stringify({
          runId: input.runId,
          profileId: input.profileId,
          sourceKey: input.sourceKey,
          inputFingerprint:
            input.inputFingerprint,
        }),
      ],
    );
  }

  private async finishRun(
    registryId: string,
    runId: string,
    status: IngestionRunStatus,
    counts: MutableCounts,
    completedAt: string,
  ): Promise<IngestionRun> {
    const result = await this.pool.query<RunRow>(
      `
        UPDATE civic_registry_ingestion_runs
        SET
          status = $3,
          total_items = $4,
          created_items = $5,
          updated_items = $6,
          unchanged_items = $7,
          validated_items = $8,
          failed_items = $9,
          completed_at = $10::timestamptz
        WHERE registry_id = $1
          AND id = $2
        RETURNING *
      `,
      [
        registryId,
        runId,
        status,
        counts.total,
        counts.created,
        counts.updated,
        counts.unchanged,
        counts.validated,
        counts.failed,
        completedAt,
      ],
    );

    if (!result.rows[0]) {
      throw new PersistenceNotFoundError(
        `Ingestion run ${registryId}/${runId} does not exist.`,
      );
    }

    return mapRun(result.rows[0]);
  }

  async run(
    input: RunIngestionInput,
  ): Promise<IngestionRunResult> {
    const sourceLabel = requireNonEmpty(
      input.sourceLabel,
      "sourceLabel",
    );
    const startedAt = validDateTime(
      input.now ?? new Date().toISOString(),
      "now",
    );
    const config = await this.configs.get(
      input.registryId,
    );

    if (!config) {
      throw new PersistenceNotFoundError(
        `Registry configuration ${input.registryId} does not exist.`,
      );
    }

    const registry =
      compileRegistryConfig(config);
    const profile =
      compileIngestionProfile(
        input.profile,
        registry,
      );
    const runId = randomUUID();
    const inputSha256 =
      sha256Fingerprint(input.input);

    await this.pool.query(
      `
        INSERT INTO civic_registry_ingestion_runs (
          registry_id,
          id,
          profile_id,
          profile,
          input_format,
          ingestion_mode,
          source_label,
          source_uri,
          input_sha256,
          dry_run,
          status,
          started_at,
          actor_id,
          reason,
          metadata
        )
        VALUES (
          $1, $2, $3, $4::jsonb, $5, $6,
          $7, $8, $9, $10, 'running',
          $11::timestamptz, $12, $13,
          $14::jsonb
        )
      `,
      [
        input.registryId,
        runId,
        profile.id,
        JSON.stringify(profile),
        input.format,
        profile.mode,
        sourceLabel,
        input.sourceUri ?? null,
        inputSha256,
        input.dryRun === true,
        startedAt,
        input.actorId ?? null,
        input.reason ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );

    const counts: MutableCounts = {
      total: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      validated: 0,
      failed: 0,
    };

    try {
      const decoded = decodeIngestionInput(
        input.input,
        input.format,
        {
          csvDelimiter:
            input.csvDelimiter,
        },
      );

      for (const issue of decoded.issues) {
        counts.total += 1;
        counts.failed += 1;

        await this.insertItem({
          registryId: input.registryId,
          runId,
          itemIndex: issue.index,
          lineNumber: issue.line,
          outcome: "failed",
          errorCode: issue.code,
          errorMessage: issue.message,
          errorDetails: [issue],
          processedAt: startedAt,
        });
      }

      const seenSourceKeys = new Set<string>();
      const seenRecordIds = new Set<string>();

      for (const row of decoded.rows) {
        counts.total += 1;

        const mapped = mapIngestionRow(
          row,
          profile,
          registry,
          {
            now: startedAt,
          },
        );

        if (!mapped.ok) {
          counts.failed += 1;
          const first = mapped.issues[0];

          await this.insertItem({
            registryId: input.registryId,
            runId,
            itemIndex: row.index,
            lineNumber: row.line,
            inputFingerprint:
              row.fingerprint,
            outcome: "failed",
            errorCode:
              first?.code ??
              "mapping_failed",
            errorMessage:
              first?.message ??
              "Row mapping failed.",
            errorDetails: mapped.issues,
            processedAt: startedAt,
          });
          continue;
        }

        const item = mapped.item;

        if (
          seenSourceKeys.has(item.sourceKey)
        ) {
          counts.failed += 1;
          await this.insertItem({
            registryId: input.registryId,
            runId,
            itemIndex: item.index,
            lineNumber: item.line,
            sourceKey: item.sourceKey,
            recordId: item.record.id,
            inputFingerprint:
              item.inputFingerprint,
            outcome: "failed",
            errorCode:
              "duplicate_source_key",
            errorMessage:
              `Source key ${item.sourceKey} appears more than once in this ingestion run.`,
            errorDetails: [
              {
                code:
                  "duplicate_source_key",
                message:
                  `Source key ${item.sourceKey} appears more than once in this ingestion run.`,
                index: item.index,
                line: item.line,
              },
            ],
            processedAt: startedAt,
          });
          continue;
        }

        if (
          seenRecordIds.has(item.record.id)
        ) {
          counts.failed += 1;
          await this.insertItem({
            registryId: input.registryId,
            runId,
            itemIndex: item.index,
            lineNumber: item.line,
            sourceKey: item.sourceKey,
            recordId: item.record.id,
            inputFingerprint:
              item.inputFingerprint,
            outcome: "failed",
            errorCode:
              "duplicate_record_id",
            errorMessage:
              `Record id ${item.record.id} is produced more than once in this ingestion run.`,
            errorDetails: [
              {
                code:
                  "duplicate_record_id",
                message:
                  `Record id ${item.record.id} is produced more than once in this ingestion run.`,
                index: item.index,
                line: item.line,
              },
            ],
            processedAt: startedAt,
          });
          continue;
        }

        seenSourceKeys.add(item.sourceKey);
        seenRecordIds.add(item.record.id);

        try {
          const existing =
            await this.records.get(
              input.registryId,
              item.record.id,
            );
          let outcome:
            | "created"
            | "updated"
            | "unchanged";

          if (!existing) {
            if (
              registry.publicationLifecycle &&
              item.record.status !==
                registry.publicationLifecycle
                  .definition.initialStatusId &&
              !profile.allowLifecycleBootstrap
            ) {
              throw new PersistenceConflictError(
                `Imported record ${item.record.id} begins in lifecycle status ${item.record.status}; set allowLifecycleBootstrap: true only when importing authoritative pre-existing state.`,
              );
            }

            if (input.dryRun) {
              counts.validated += 1;
              await this.insertItem({
                registryId: input.registryId,
                runId,
                itemIndex: item.index,
                lineNumber: item.line,
                sourceKey: item.sourceKey,
                recordId: item.record.id,
                inputFingerprint:
                  item.inputFingerprint,
                outcome: "validated",
                processedAt: startedAt,
              });
              continue;
            }

            await this.records.create(
              item.record,
              {
                bootstrapLifecycle:
                  profile.allowLifecycleBootstrap,
              },
            );
            outcome = "created";
            counts.created += 1;
          } else {
            if (profile.mode === "create") {
              throw new PersistenceConflictError(
                `Record ${input.registryId}/${item.record.id} already exists and profile mode is create.`,
              );
            }

            if (
              existing.recordTypeId !==
              item.record.recordTypeId
            ) {
              throw new PersistenceConflictError(
                `Existing record ${item.record.id} has record type ${existing.recordTypeId}; ingestion profile targets ${item.record.recordTypeId}.`,
              );
            }

            const candidate =
              candidateForExisting(
                existing,
                item.record,
                profile,
                startedAt,
              );

            if (
              registry.publicationLifecycle &&
              candidate.status !==
                existing.status
            ) {
              throw new PersistenceConflictError(
                "Ingestion cannot bypass configured publication lifecycle transitions for an existing record.",
              );
            }

            if (input.dryRun) {
              counts.validated += 1;
              await this.insertItem({
                registryId: input.registryId,
                runId,
                itemIndex: item.index,
                lineNumber: item.line,
                sourceKey: item.sourceKey,
                recordId: item.record.id,
                inputFingerprint:
                  item.inputFingerprint,
                outcome: "validated",
                processedAt: startedAt,
              });
              continue;
            }

            if (
              recordsEquivalent(
                existing,
                candidate,
              )
            ) {
              outcome = "unchanged";
              counts.unchanged += 1;
            } else {
              await this.records.update(
                candidate,
              );
              outcome = "updated";
              counts.updated += 1;
            }
          }

          await this.insertRecordAudit({
            registryId: input.registryId,
            recordId: item.record.id,
            runId,
            profileId: profile.id,
            sourceKey: item.sourceKey,
            inputFingerprint:
              item.inputFingerprint,
            outcome,
            occurredAt: startedAt,
            actorId: input.actorId,
            reason: input.reason,
          });
          await this.insertItem({
            registryId: input.registryId,
            runId,
            itemIndex: item.index,
            lineNumber: item.line,
            sourceKey: item.sourceKey,
            recordId: item.record.id,
            inputFingerprint:
              item.inputFingerprint,
            outcome,
            processedAt: startedAt,
          });
        } catch (error) {
          counts.failed += 1;
          const failure =
            failureFromError(error);

          await this.insertItem({
            registryId: input.registryId,
            runId,
            itemIndex: item.index,
            lineNumber: item.line,
            sourceKey: item.sourceKey,
            recordId: item.record.id,
            inputFingerprint:
              item.inputFingerprint,
            outcome: "failed",
            errorCode: failure.code,
            errorMessage: failure.message,
            errorDetails: failure.details,
            processedAt: startedAt,
          });
        }
      }

      const status: IngestionRunStatus =
        counts.failed > 0
          ? "completed_with_errors"
          : "completed";
      const run = await this.finishRun(
        input.registryId,
        runId,
        status,
        counts,
        startedAt,
      );

      return { run };
    } catch (error) {
      await this.finishRun(
        input.registryId,
        runId,
        "failed",
        counts,
        startedAt,
      );
      throw error;
    }
  }
}
