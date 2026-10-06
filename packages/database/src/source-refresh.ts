
import { randomUUID } from "node:crypto";

import type {
  SourceAdapterRunManifest,
  SourceAdapterRunOptions,
  SourceAdapterWarning,
} from "@civic-registry/source-adapters";
import type {
  Pool,
  PoolClient,
  QueryResultRow,
} from "pg";

import {
  PersistenceNotFoundError,
} from "./repositories.ts";

export type SourceRefreshRunStatus =
  | "running"
  | "completed"
  | "completed_with_warnings"
  | "failed";

export type SourceRefreshHealthStatus =
  | "disabled"
  | "never_run"
  | "running"
  | "healthy"
  | "warning"
  | "failing"
  | "stale";

export type EmptyResultBehavior =
  | "allow"
  | "warning"
  | "failure";

export interface SourceRefreshJobDefinition {
  id: string;
  registryId: string;
  label: string;
  adapterId: string;
  profileId: string;
  enabled?: boolean;
  intervalSeconds: number;
  staleAfterSeconds: number;
  failureBackoffBaseSeconds?: number;
  failureBackoffMaxSeconds?: number;
  adapterOptions?: Omit<
    SourceAdapterRunOptions,
    "retrievedAt"
  >;
  emptyResultBehavior?: EmptyResultBehavior;
  rowCountDropWarningPercent?: number;
}

export interface SourceRefreshJob
  extends Required<
    Pick<
      SourceRefreshJobDefinition,
      | "id"
      | "registryId"
      | "label"
      | "adapterId"
      | "profileId"
      | "intervalSeconds"
      | "staleAfterSeconds"
      | "emptyResultBehavior"
      | "rowCountDropWarningPercent"
    >
  > {
  enabled: boolean;
  failureBackoffBaseSeconds: number;
  failureBackoffMaxSeconds: number;
  adapterOptions: Omit<
    SourceAdapterRunOptions,
    "retrievedAt"
  >;
  nextRunAt: string;
  leaseToken?: string;
  leaseExpiresAt?: string;
  lastStartedAt?: string;
  lastCompletedAt?: string;
  lastStatus?: Exclude<
    SourceRefreshRunStatus,
    "running"
  >;
  lastRowCount?: number;
  lastWarningCount?: number;
  lastOutputSha256?: string;
  lastIngestionRunId?: string;
  consecutiveFailures: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SourceRefreshRun {
  id: string;
  registryId: string;
  jobId: string;
  adapterId: string;
  profileId: string;
  status: SourceRefreshRunStatus;
  leaseToken: string;
  startedAt: string;
  completedAt?: string;
  rowCount?: number;
  previousRowCount?: number;
  rowCountDelta?: number;
  warningCount?: number;
  outputSha256?: string;
  sourcePages: string[];
  warnings: SourceAdapterWarning[];
  ingestionRunId?: string;
  ingestionStatus?: string;
  ingestionFailedItems?: number;
  errorMessage?: string;
  metadata: Record<string, unknown>;
}

export interface SourceRefreshHealth {
  job: SourceRefreshJob;
  status: SourceRefreshHealthStatus;
  reason: string;
  secondsSinceLastCompletion?: number;
  nextRunAt: string;
}

export interface SourceRefreshClaim {
  job: SourceRefreshJob;
  run: SourceRefreshRun;
}

export interface SourceRefreshExecutionResult {
  manifest: SourceAdapterRunManifest;
  ingestionRunId?: string;
  ingestionStatus?: string;
  ingestionFailedItems?: number;
  metadata?: Record<string, unknown>;
}

export type SourceRefreshExecutor = (
  claim: SourceRefreshClaim,
) => Promise<SourceRefreshExecutionResult>;

export interface RunDueSourceRefreshOptions {
  registryId?: string;
  limit?: number;
  leaseSeconds?: number;
  now?: string;
  executor: SourceRefreshExecutor;
}

export interface RunDueSourceRefreshResult {
  claimed: number;
  completed: number;
  completedWithWarnings: number;
  failed: number;
  runs: SourceRefreshRun[];
}

interface JobRow extends QueryResultRow {
  registry_id: string;
  id: string;
  label: string;
  adapter_id: string;
  profile_id: string;
  enabled: boolean;
  interval_seconds: number;
  stale_after_seconds: number;
  failure_backoff_base_seconds: number;
  failure_backoff_max_seconds: number;
  adapter_options: Omit<
    SourceAdapterRunOptions,
    "retrievedAt"
  >;
  empty_result_behavior: EmptyResultBehavior;
  row_count_drop_warning_percent: number;
  next_run_at: Date;
  lease_token: string | null;
  lease_expires_at: Date | null;
  last_started_at: Date | null;
  last_completed_at: Date | null;
  last_status: Exclude<
    SourceRefreshRunStatus,
    "running"
  > | null;
  last_row_count: number | null;
  last_warning_count: number | null;
  last_output_sha256: string | null;
  last_ingestion_run_id: string | null;
  consecutive_failures: number;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

interface RunRow extends QueryResultRow {
  registry_id: string;
  id: string;
  job_id: string;
  adapter_id: string;
  profile_id: string;
  status: SourceRefreshRunStatus;
  lease_token: string;
  started_at: Date;
  completed_at: Date | null;
  row_count: number | null;
  previous_row_count: number | null;
  row_count_delta: number | null;
  warning_count: number | null;
  output_sha256: string | null;
  source_pages: string[];
  warnings: SourceAdapterWarning[];
  ingestion_run_id: string | null;
  ingestion_status: string | null;
  ingestion_failed_items: number | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
}

function mapJob(row: JobRow): SourceRefreshJob {
  return {
    id: row.id,
    registryId: row.registry_id,
    label: row.label,
    adapterId: row.adapter_id,
    profileId: row.profile_id,
    enabled: row.enabled,
    intervalSeconds: row.interval_seconds,
    staleAfterSeconds:
      row.stale_after_seconds,
    failureBackoffBaseSeconds:
      row.failure_backoff_base_seconds,
    failureBackoffMaxSeconds:
      row.failure_backoff_max_seconds,
    adapterOptions:
      row.adapter_options ?? {},
    emptyResultBehavior:
      row.empty_result_behavior,
    rowCountDropWarningPercent:
      row.row_count_drop_warning_percent,
    nextRunAt:
      row.next_run_at.toISOString(),
    leaseToken:
      row.lease_token ?? undefined,
    leaseExpiresAt:
      row.lease_expires_at?.toISOString(),
    lastStartedAt:
      row.last_started_at?.toISOString(),
    lastCompletedAt:
      row.last_completed_at?.toISOString(),
    lastStatus:
      row.last_status ?? undefined,
    lastRowCount:
      row.last_row_count ?? undefined,
    lastWarningCount:
      row.last_warning_count ?? undefined,
    lastOutputSha256:
      row.last_output_sha256 ?? undefined,
    lastIngestionRunId:
      row.last_ingestion_run_id ?? undefined,
    consecutiveFailures:
      row.consecutive_failures,
    lastError:
      row.last_error ?? undefined,
    createdAt:
      row.created_at.toISOString(),
    updatedAt:
      row.updated_at.toISOString(),
  };
}

function mapRun(row: RunRow): SourceRefreshRun {
  return {
    id: row.id,
    registryId: row.registry_id,
    jobId: row.job_id,
    adapterId: row.adapter_id,
    profileId: row.profile_id,
    status: row.status,
    leaseToken: row.lease_token,
    startedAt:
      row.started_at.toISOString(),
    completedAt:
      row.completed_at?.toISOString(),
    rowCount:
      row.row_count ?? undefined,
    previousRowCount:
      row.previous_row_count ?? undefined,
    rowCountDelta:
      row.row_count_delta ?? undefined,
    warningCount:
      row.warning_count ?? undefined,
    outputSha256:
      row.output_sha256 ?? undefined,
    sourcePages:
      row.source_pages ?? [],
    warnings:
      row.warnings ?? [],
    ingestionRunId:
      row.ingestion_run_id ?? undefined,
    ingestionStatus:
      row.ingestion_status ?? undefined,
    ingestionFailedItems:
      row.ingestion_failed_items ?? undefined,
    errorMessage:
      row.error_message ?? undefined,
    metadata:
      row.metadata ?? {},
  };
}

function positiveInteger(
  value: number,
  label: string,
): number {
  const normalized = Math.trunc(value);

  if (
    !Number.isInteger(normalized) ||
    normalized < 1
  ) {
    throw new Error(
      label + " must be a positive integer.",
    );
  }

  return normalized;
}

function percentage(
  value: number | undefined,
  fallback: number,
): number {
  const normalized = Math.trunc(
    value ?? fallback,
  );

  if (
    normalized < 0 ||
    normalized > 100
  ) {
    throw new Error(
      "rowCountDropWarningPercent must be between 0 and 100.",
    );
  }

  return normalized;
}

function validDateTime(
  value: string,
  label: string,
): string {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.valueOf())) {
    throw new Error(
      label + " must be a valid date-time.",
    );
  }

  return parsed.toISOString();
}

function normalizedDefinition(
  definition: SourceRefreshJobDefinition,
): Required<
  Omit<
    SourceRefreshJobDefinition,
    "adapterOptions"
  >
> & {
  adapterOptions: Omit<
    SourceAdapterRunOptions,
    "retrievedAt"
  >;
} {
  const id = definition.id.trim();
  const registryId =
    definition.registryId.trim();
  const label =
    definition.label.trim();
  const adapterId =
    definition.adapterId.trim();
  const profileId =
    definition.profileId.trim();

  if (
    !id ||
    !registryId ||
    !label ||
    !adapterId ||
    !profileId
  ) {
    throw new Error(
      "Source refresh job identifiers and label must be non-empty.",
    );
  }

  const base = positiveInteger(
    definition.failureBackoffBaseSeconds ??
      900,
    "failureBackoffBaseSeconds",
  );
  const max = positiveInteger(
    definition.failureBackoffMaxSeconds ??
      21_600,
    "failureBackoffMaxSeconds",
  );

  if (max < base) {
    throw new Error(
      "failureBackoffMaxSeconds must be greater than or equal to failureBackoffBaseSeconds.",
    );
  }

  return {
    ...definition,
    id,
    registryId,
    label,
    adapterId,
    profileId,
    enabled:
      definition.enabled !== false,
    intervalSeconds:
      positiveInteger(
        definition.intervalSeconds,
        "intervalSeconds",
      ),
    staleAfterSeconds:
      positiveInteger(
        definition.staleAfterSeconds,
        "staleAfterSeconds",
      ),
    failureBackoffBaseSeconds:
      base,
    failureBackoffMaxSeconds:
      max,
    adapterOptions:
      definition.adapterOptions ?? {},
    emptyResultBehavior:
      definition.emptyResultBehavior ??
      "warning",
    rowCountDropWarningPercent:
      percentage(
        definition.rowCountDropWarningPercent,
        50,
      ),
  };
}

function secondsFrom(
  date: string,
  now: string,
): number {
  return Math.max(
    0,
    Math.floor(
      (
        new Date(now).valueOf() -
        new Date(date).valueOf()
      ) / 1000,
    ),
  );
}

function computeDropPercent(
  previous: number,
  current: number,
): number {
  if (previous <= 0 || current >= previous) {
    return 0;
  }

  return Math.round(
    ((previous - current) / previous) *
      100,
  );
}

export class PostgresSourceRefreshService {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async syncDefinitions(
    registryId: string,
    definitions: SourceRefreshJobDefinition[],
    options: {
      now?: string;
      disableMissing?: boolean;
    } = {},
  ): Promise<SourceRefreshJob[]> {
    const now = validDateTime(
      options.now ??
        new Date().toISOString(),
      "now",
    );
    const registry =
      registryId.trim();

    if (!registry) {
      throw new Error(
        "registryId must be non-empty.",
      );
    }

    const exists =
      await this.pool.query(
        `
          SELECT 1
          FROM civic_registry_configurations
          WHERE registry_id = $1
        `,
        [registry],
      );

    if (!exists.rows[0]) {
      throw new PersistenceNotFoundError(
        "Registry configuration " +
          registry +
          " does not exist.",
      );
    }

    const normalized =
      definitions.map(
        normalizedDefinition,
      );

    for (const definition of normalized) {
      if (
        definition.registryId !==
        registry
      ) {
        throw new Error(
          "All source refresh definitions must match registryId " +
            registry +
            ".",
        );
      }
    }

    const ids = normalized.map(
      (definition) => definition.id,
    );
    const client =
      await this.pool.connect();

    try {
      await client.query("BEGIN");

      for (const definition of normalized) {
        await client.query(
          `
            INSERT INTO civic_registry_source_refresh_jobs (
              registry_id,
              id,
              label,
              adapter_id,
              profile_id,
              enabled,
              interval_seconds,
              stale_after_seconds,
              failure_backoff_base_seconds,
              failure_backoff_max_seconds,
              adapter_options,
              empty_result_behavior,
              row_count_drop_warning_percent,
              next_run_at,
              created_at,
              updated_at
            )
            VALUES (
              $1, $2, $3, $4, $5, $6,
              $7, $8, $9, $10,
              $11::jsonb, $12, $13,
              $14::timestamptz,
              $14::timestamptz,
              $14::timestamptz
            )
            ON CONFLICT (registry_id, id)
            DO UPDATE SET
              label = EXCLUDED.label,
              adapter_id = EXCLUDED.adapter_id,
              profile_id = EXCLUDED.profile_id,
              interval_seconds =
                EXCLUDED.interval_seconds,
              stale_after_seconds =
                EXCLUDED.stale_after_seconds,
              failure_backoff_base_seconds =
                EXCLUDED.failure_backoff_base_seconds,
              failure_backoff_max_seconds =
                EXCLUDED.failure_backoff_max_seconds,
              adapter_options =
                EXCLUDED.adapter_options,
              empty_result_behavior =
                EXCLUDED.empty_result_behavior,
              row_count_drop_warning_percent =
                EXCLUDED.row_count_drop_warning_percent,
              updated_at =
                EXCLUDED.updated_at
          `,
          [
            registry,
            definition.id,
            definition.label,
            definition.adapterId,
            definition.profileId,
            definition.enabled,
            definition.intervalSeconds,
            definition.staleAfterSeconds,
            definition.failureBackoffBaseSeconds,
            definition.failureBackoffMaxSeconds,
            JSON.stringify(
              definition.adapterOptions,
            ),
            definition.emptyResultBehavior,
            definition.rowCountDropWarningPercent,
            now,
          ],
        );

        if (
          definition.enabled === false
        ) {
          await client.query(
            `
              UPDATE civic_registry_source_refresh_jobs
              SET
                enabled = FALSE,
                lease_token = NULL,
                lease_expires_at = NULL,
                updated_at = $3::timestamptz
              WHERE registry_id = $1
                AND id = $2
            `,
            [
              registry,
              definition.id,
              now,
            ],
          );
        }
      }

      if (
        options.disableMissing !== false
      ) {
        await client.query(
          `
            UPDATE civic_registry_source_refresh_jobs
            SET
              enabled = FALSE,
              lease_token = NULL,
              lease_expires_at = NULL,
              updated_at = $3::timestamptz
            WHERE registry_id = $1
              AND NOT (
                id = ANY($2::text[])
              )
          `,
          [registry, ids, now],
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return this.listJobs(registry);
  }

  async listJobs(
    registryId: string,
  ): Promise<SourceRefreshJob[]> {
    const result =
      await this.pool.query<JobRow>(
        `
          SELECT *
          FROM civic_registry_source_refresh_jobs
          WHERE registry_id = $1
          ORDER BY label ASC, id ASC
        `,
        [registryId],
      );

    return result.rows.map(mapJob);
  }

  async getJob(
    registryId: string,
    jobId: string,
  ): Promise<SourceRefreshJob | null> {
    const result =
      await this.pool.query<JobRow>(
        `
          SELECT *
          FROM civic_registry_source_refresh_jobs
          WHERE registry_id = $1
            AND id = $2
        `,
        [registryId, jobId],
      );

    return result.rows[0]
      ? mapJob(result.rows[0])
      : null;
  }

  async listRuns(
    registryId: string,
    options: {
      jobId?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<SourceRefreshRun[]> {
    const values: unknown[] = [
      registryId,
    ];
    const where = [
      "registry_id = $1",
    ];

    if (options.jobId) {
      values.push(options.jobId);
      where.push(
        "job_id = $" +
          values.length,
      );
    }

    const limit = Math.max(
      1,
      Math.min(
        Math.trunc(
          options.limit ?? 100,
        ),
        500,
      ),
    );
    const offset = Math.max(
      0,
      Math.trunc(
        options.offset ?? 0,
      ),
    );
    values.push(limit);
    const limitParameter =
      "$" + values.length;
    values.push(offset);
    const offsetParameter =
      "$" + values.length;

    const result =
      await this.pool.query<RunRow>(
        `
          SELECT *
          FROM civic_registry_source_refresh_runs
          WHERE ` +
          where.join(" AND ") +
          `
          ORDER BY started_at DESC, id DESC
          LIMIT ` +
          limitParameter +
          `
          OFFSET ` +
          offsetParameter,
        values,
      );

    return result.rows.map(mapRun);
  }

  getHealth(
    job: SourceRefreshJob,
    nowValue?: string,
  ): SourceRefreshHealth {
    const now = validDateTime(
      nowValue ??
        new Date().toISOString(),
      "now",
    );

    if (!job.enabled) {
      return {
        job,
        status: "disabled",
        reason:
          "Scheduled refresh is disabled.",
        nextRunAt: job.nextRunAt,
      };
    }

    if (
      job.leaseToken &&
      job.leaseExpiresAt &&
      new Date(job.leaseExpiresAt) >
        new Date(now)
    ) {
      return {
        job,
        status: "running",
        reason:
          "A worker currently holds the refresh lease.",
        nextRunAt: job.nextRunAt,
      };
    }

    if (job.lastStatus === "failed") {
      return {
        job,
        status: "failing",
        reason:
          job.lastError ||
          "The most recent refresh failed.",
        nextRunAt: job.nextRunAt,
        ...(job.lastCompletedAt
          ? {
              secondsSinceLastCompletion:
                secondsFrom(
                  job.lastCompletedAt,
                  now,
                ),
            }
          : {}),
      };
    }

    if (!job.lastCompletedAt) {
      return {
        job,
        status: "never_run",
        reason:
          "No refresh has completed yet.",
        nextRunAt: job.nextRunAt,
      };
    }

    const age = secondsFrom(
      job.lastCompletedAt,
      now,
    );

    if (
      age > job.staleAfterSeconds
    ) {
      return {
        job,
        status: "stale",
        reason:
          "The last completed refresh is older than the configured stale threshold.",
        secondsSinceLastCompletion: age,
        nextRunAt: job.nextRunAt,
      };
    }

    if (
      job.lastStatus ===
        "completed_with_warnings" ||
      (job.lastWarningCount ?? 0) > 0
    ) {
      return {
        job,
        status: "warning",
        reason:
          "The most recent refresh completed with warnings.",
        secondsSinceLastCompletion: age,
        nextRunAt: job.nextRunAt,
      };
    }

    return {
      job,
      status: "healthy",
      reason:
        "The most recent refresh completed successfully.",
      secondsSinceLastCompletion: age,
      nextRunAt: job.nextRunAt,
    };
  }

  async listHealth(
    registryId: string,
    now?: string,
  ): Promise<SourceRefreshHealth[]> {
    const jobs =
      await this.listJobs(registryId);

    return jobs.map((job) =>
      this.getHealth(job, now),
    );
  }

  async setEnabled(
    registryId: string,
    jobId: string,
    enabled: boolean,
    nowValue?: string,
  ): Promise<SourceRefreshJob> {
    const now = validDateTime(
      nowValue ??
        new Date().toISOString(),
      "now",
    );
    const result =
      await this.pool.query<JobRow>(
        `
          UPDATE civic_registry_source_refresh_jobs
          SET
            enabled = $3,
            next_run_at = CASE
              WHEN $3
                THEN LEAST(
                  next_run_at,
                  $4::timestamptz
                )
              ELSE next_run_at
            END,
            lease_token = CASE
              WHEN $3 THEN lease_token
              ELSE NULL
            END,
            lease_expires_at = CASE
              WHEN $3 THEN lease_expires_at
              ELSE NULL
            END,
            updated_at = $4::timestamptz
          WHERE registry_id = $1
            AND id = $2
          RETURNING *
        `,
        [
          registryId,
          jobId,
          enabled,
          now,
        ],
      );

    if (!result.rows[0]) {
      throw new PersistenceNotFoundError(
        "Source refresh job " +
          registryId +
          "/" +
          jobId +
          " does not exist.",
      );
    }

    return mapJob(result.rows[0]);
  }

  async queueNow(
    registryId: string,
    jobId: string,
    nowValue?: string,
  ): Promise<SourceRefreshJob> {
    const now = validDateTime(
      nowValue ??
        new Date().toISOString(),
      "now",
    );
    const result =
      await this.pool.query<JobRow>(
        `
          UPDATE civic_registry_source_refresh_jobs
          SET
            next_run_at = $3::timestamptz,
            updated_at = $3::timestamptz
          WHERE registry_id = $1
            AND id = $2
            AND enabled = TRUE
            AND (
              lease_token IS NULL
              OR lease_expires_at <=
                $3::timestamptz
            )
          RETURNING *
        `,
        [
          registryId,
          jobId,
          now,
        ],
      );

    if (!result.rows[0]) {
      const existing =
        await this.getJob(
          registryId,
          jobId,
        );

      if (!existing) {
        throw new PersistenceNotFoundError(
          "Source refresh job " +
            registryId +
            "/" +
            jobId +
            " does not exist.",
        );
      }

      if (!existing.enabled) {
        throw new Error(
          "Disabled source refresh jobs cannot be queued.",
        );
      }

      throw new Error(
        "Source refresh job is already running.",
      );
    }

    return mapJob(result.rows[0]);
  }

  private async claimDue(
    options: {
      registryId?: string;
      limit: number;
      leaseSeconds: number;
      now: string;
    },
  ): Promise<SourceRefreshClaim[]> {
    const client =
      await this.pool.connect();

    try {
      await client.query("BEGIN");

      const values: unknown[] = [
        options.now,
      ];
      const where = [
        "enabled = TRUE",
        "next_run_at <= $1::timestamptz",
        "(lease_token IS NULL OR lease_expires_at <= $1::timestamptz)",
      ];

      if (options.registryId) {
        values.push(
          options.registryId,
        );
        where.push(
          "registry_id = $" +
            values.length,
        );
      }

      values.push(options.limit);
      const limitParameter =
        "$" + values.length;
      const selected =
        await client.query<JobRow>(
          `
            SELECT *
            FROM civic_registry_source_refresh_jobs
            WHERE ` +
            where.join(" AND ") +
            `
            ORDER BY
              next_run_at ASC,
              registry_id ASC,
              id ASC
            FOR UPDATE SKIP LOCKED
            LIMIT ` +
            limitParameter,
          values,
        );

      const claims:
        SourceRefreshClaim[] = [];

      for (const row of selected.rows) {
        await client.query(
          `
            UPDATE civic_registry_source_refresh_runs
            SET
              status = 'failed',
              completed_at =
                $3::timestamptz,
              error_message =
                COALESCE(
                  error_message,
                  'Worker lease expired before refresh completion.'
                )
            WHERE registry_id = $1
              AND job_id = $2
              AND status = 'running'
          `,
          [
            row.registry_id,
            row.id,
            options.now,
          ],
        );

        const leaseToken =
          randomUUID();
        const runId =
          randomUUID();
        const leaseExpiresAt =
          new Date(
            new Date(
              options.now,
            ).valueOf() +
              options.leaseSeconds *
                1000,
          ).toISOString();

        const updated =
          await client.query<JobRow>(
            `
              UPDATE civic_registry_source_refresh_jobs
              SET
                lease_token = $3,
                lease_expires_at =
                  $4::timestamptz,
                last_started_at =
                  $5::timestamptz,
                updated_at =
                  $5::timestamptz
              WHERE registry_id = $1
                AND id = $2
              RETURNING *
            `,
            [
              row.registry_id,
              row.id,
              leaseToken,
              leaseExpiresAt,
              options.now,
            ],
          );

        const run =
          await client.query<RunRow>(
            `
              INSERT INTO civic_registry_source_refresh_runs (
                registry_id,
                id,
                job_id,
                adapter_id,
                profile_id,
                status,
                lease_token,
                started_at,
                previous_row_count,
                metadata
              )
              VALUES (
                $1, $2, $3, $4, $5,
                'running',
                $6,
                $7::timestamptz,
                $8,
                '{}'::jsonb
              )
              RETURNING *
            `,
            [
              row.registry_id,
              runId,
              row.id,
              row.adapter_id,
              row.profile_id,
              leaseToken,
              options.now,
              row.last_row_count,
            ],
          );

        claims.push({
          job: mapJob(
            updated.rows[0],
          ),
          run: mapRun(
            run.rows[0],
          ),
        });
      }

      await client.query("COMMIT");
      return claims;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async completeClaim(
    claim: SourceRefreshClaim,
    result: SourceRefreshExecutionResult,
    completedAt: string,
  ): Promise<SourceRefreshRun> {
    const warnings = [
      ...result.manifest.warnings,
    ];
    const rowCount =
      result.manifest.rowCount;
    const previous =
      claim.job.lastRowCount;
    const dropPercent =
      previous === undefined
        ? 0
        : computeDropPercent(
            previous,
            rowCount,
          );

    if (rowCount === 0) {
      if (
        claim.job.emptyResultBehavior ===
        "failure"
      ) {
        throw new Error(
          "Source refresh returned zero rows and the job treats empty results as failures.",
        );
      }

      if (
        claim.job.emptyResultBehavior ===
        "warning"
      ) {
        warnings.push({
          code:
            "source_refresh_empty_result",
          message:
            "Source refresh returned zero rows.",
        });
      }
    }

    if (
      previous !== undefined &&
      previous > 0 &&
      dropPercent >=
        claim.job
          .rowCountDropWarningPercent &&
      rowCount < previous
    ) {
      warnings.push({
        code:
          "source_refresh_row_count_drop",
        message:
          "Source refresh row count dropped " +
          String(dropPercent) +
          "% from the previous run.",
      });
    }

    if (
      result.ingestionStatus ===
        "failed"
    ) {
      throw new Error(
        "The ingestion run associated with this refresh failed.",
      );
    }

    if (
      result.ingestionStatus ===
        "completed_with_errors" ||
      (result.ingestionFailedItems ?? 0) >
        0
    ) {
      warnings.push({
        code:
          "source_refresh_ingestion_errors",
        message:
          "The refresh ingestion run completed with one or more item failures.",
      });
    }

    const status:
      SourceRefreshRunStatus =
      warnings.length > 0
        ? "completed_with_warnings"
        : "completed";
    const nextRunAt =
      new Date(
        new Date(
          completedAt,
        ).valueOf() +
          claim.job.intervalSeconds *
            1000,
      ).toISOString();
    const client =
      await this.pool.connect();

    try {
      await client.query("BEGIN");

      const runResult =
        await client.query<RunRow>(
          `
            UPDATE civic_registry_source_refresh_runs
            SET
              status = $4,
              completed_at =
                $5::timestamptz,
              row_count = $6,
              row_count_delta =
                CASE
                  WHEN previous_row_count
                    IS NULL
                    THEN NULL
                  ELSE $6 -
                    previous_row_count
                END,
              warning_count = $7,
              output_sha256 = $8,
              source_pages =
                $9::jsonb,
              warnings =
                $10::jsonb,
              ingestion_run_id = $11,
              ingestion_status = $12,
              ingestion_failed_items = $13,
              metadata = $14::jsonb
            WHERE registry_id = $1
              AND id = $2
              AND lease_token = $3
              AND status = 'running'
            RETURNING *
          `,
          [
            claim.job.registryId,
            claim.run.id,
            claim.run.leaseToken,
            status,
            completedAt,
            rowCount,
            warnings.length,
            result.manifest.outputSha256,
            JSON.stringify(
              result.manifest.sourcePages,
            ),
            JSON.stringify(warnings),
            result.ingestionRunId ?? null,
            result.ingestionStatus ?? null,
            result.ingestionFailedItems ??
              null,
            JSON.stringify(
              result.metadata ?? {},
            ),
          ],
        );

      if (!runResult.rows[0]) {
        throw new Error(
          "Source refresh lease is no longer valid.",
        );
      }

      await client.query(
        `
          UPDATE civic_registry_source_refresh_jobs
          SET
            lease_token = NULL,
            lease_expires_at = NULL,
            last_completed_at =
              $4::timestamptz,
            last_status = $5,
            last_row_count = $6,
            last_warning_count = $7,
            last_output_sha256 = $8,
            last_ingestion_run_id = $9,
            consecutive_failures = 0,
            last_error = NULL,
            next_run_at =
              $10::timestamptz,
            updated_at =
              $4::timestamptz
          WHERE registry_id = $1
            AND id = $2
            AND lease_token = $3
        `,
        [
          claim.job.registryId,
          claim.job.id,
          claim.run.leaseToken,
          completedAt,
          status,
          rowCount,
          warnings.length,
          result.manifest.outputSha256,
          result.ingestionRunId ?? null,
          nextRunAt,
        ],
      );

      await client.query("COMMIT");
      return mapRun(
        runResult.rows[0],
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async failClaim(
    claim: SourceRefreshClaim,
    error: unknown,
    completedAt: string,
  ): Promise<SourceRefreshRun> {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown source refresh failure.";
    const failures =
      claim.job.consecutiveFailures +
      1;
    const exponent =
      Math.min(
        failures - 1,
        20,
      );
    const delay =
      Math.min(
        claim.job
          .failureBackoffMaxSeconds,
        claim.job
          .failureBackoffBaseSeconds *
          2 ** exponent,
      );
    const nextRunAt =
      new Date(
        new Date(
          completedAt,
        ).valueOf() +
          delay * 1000,
      ).toISOString();
    const client =
      await this.pool.connect();

    try {
      await client.query("BEGIN");

      const runResult =
        await client.query<RunRow>(
          `
            UPDATE civic_registry_source_refresh_runs
            SET
              status = 'failed',
              completed_at =
                $4::timestamptz,
              error_message = $5
            WHERE registry_id = $1
              AND id = $2
              AND lease_token = $3
              AND status = 'running'
            RETURNING *
          `,
          [
            claim.job.registryId,
            claim.run.id,
            claim.run.leaseToken,
            completedAt,
            message,
          ],
        );

      if (!runResult.rows[0]) {
        throw new Error(
          "Source refresh lease is no longer valid.",
        );
      }

      await client.query(
        `
          UPDATE civic_registry_source_refresh_jobs
          SET
            lease_token = NULL,
            lease_expires_at = NULL,
            last_completed_at =
              $4::timestamptz,
            last_status = 'failed',
            last_warning_count = NULL,
            consecutive_failures = $5,
            last_error = $6,
            next_run_at =
              $7::timestamptz,
            updated_at =
              $4::timestamptz
          WHERE registry_id = $1
            AND id = $2
            AND lease_token = $3
        `,
        [
          claim.job.registryId,
          claim.job.id,
          claim.run.leaseToken,
          completedAt,
          failures,
          message,
          nextRunAt,
        ],
      );

      await client.query("COMMIT");
      return mapRun(
        runResult.rows[0],
      );
    } catch (failure) {
      await client.query("ROLLBACK");
      throw failure;
    } finally {
      client.release();
    }
  }

  async runDue(
    options: RunDueSourceRefreshOptions,
  ): Promise<RunDueSourceRefreshResult> {
    const now = validDateTime(
      options.now ??
        new Date().toISOString(),
      "now",
    );
    const limit = Math.max(
      1,
      Math.min(
        Math.trunc(
          options.limit ?? 10,
        ),
        100,
      ),
    );
    const leaseSeconds =
      Math.max(
        60,
        Math.min(
          Math.trunc(
            options.leaseSeconds ??
              1800,
          ),
          86_400,
        ),
      );
    const claims =
      await this.claimDue({
        registryId:
          options.registryId,
        limit,
        leaseSeconds,
        now,
      });
    const runs:
      SourceRefreshRun[] = [];
    let completed = 0;
    let completedWithWarnings = 0;
    let failed = 0;

    for (const claim of claims) {
      try {
        const result =
          await options.executor(
            claim,
          );
        const finishedAt =
          new Date().toISOString();
        const run =
          await this.completeClaim(
            claim,
            result,
            finishedAt,
          );
        runs.push(run);

        if (
          run.status ===
          "completed_with_warnings"
        ) {
          completedWithWarnings += 1;
        } else {
          completed += 1;
        }
      } catch (error) {
        const finishedAt =
          new Date().toISOString();
        const run =
          await this.failClaim(
            claim,
            error,
            finishedAt,
          );
        runs.push(run);
        failed += 1;
      }
    }

    return {
      claimed: claims.length,
      completed,
      completedWithWarnings,
      failed,
      runs,
    };
  }
}
