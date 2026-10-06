import type { Pool, QueryResultRow } from "pg";

export type AnalyticsScope = "internal" | "public";

export interface AnalyticsBucket {
  key: string;
  count: number;
}

export interface AnalyticsPoint {
  period: string;
  count: number;
}

export interface RegistryAnalytics {
  registryId: string;
  scope: AnalyticsScope;
  generatedAt: string;
  totals: {
    records: number;
    published: number;
    citedRecords: number;
    evidenceCoveragePercent: number;
  };
  recordTypes: AnalyticsBucket[];
  statuses: AnalyticsBucket[];
  publicationTrend: AnalyticsPoint[];
  changeActivity: AnalyticsPoint[];
  deadlines: {
    open: number;
    dueSoon: number;
    overdue: number;
  };
  dimension?: {
    fieldId: string;
    recordTypeId?: string;
    values: AnalyticsBucket[];
  };
}

export interface RegistryAnalyticsOptions {
  scope?: AnalyticsScope;
  publicStatusIds?: string[];
  publicDeadlineTypeIds?: string[];
  excludeWithheld?: boolean;
  dueSoonDays?: number;
  dimensionFieldId?: string;
  dimensionRecordTypeId?: string;
  trendMonths?: number;
  dimensionLimit?: number;
}

interface CountRow extends QueryResultRow {
  count: number | string;
}

interface BucketRow extends QueryResultRow {
  key: string;
  count: number | string;
}

function asCount(value: number | string | null | undefined): number {
  return Number(value ?? 0);
}

export class PostgresAnalyticsRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async getRegistryAnalytics(
    registryId: string,
    options: RegistryAnalyticsOptions = {},
  ): Promise<RegistryAnalytics> {
    const scope = options.scope ?? "internal";
    const values: unknown[] = [registryId];
    const recordWhere = ["record.registry_id = $1"];

    if (scope === "public") {
      recordWhere.push("record.visibility = 'public'");

      if (options.publicStatusIds) {
        if (options.publicStatusIds.length === 0) {
          recordWhere.push("FALSE");
        } else {
          values.push([...new Set(options.publicStatusIds)]);
          recordWhere.push(
            `record.status = ANY($${values.length}::text[])`,
          );
        }
      }

      if (options.excludeWithheld) {
        recordWhere.push(`
          NOT EXISTS (
            SELECT 1
            FROM civic_registry_record_disclosures AS disclosure
            WHERE disclosure.registry_id = record.registry_id
              AND disclosure.record_id = record.id
              AND disclosure.disposition = 'withheld'
          )
        `);
      }
    }

    const where = recordWhere.join(" AND ");
    const trendMonths = Math.max(
      1,
      Math.min(Math.trunc(options.trendMonths ?? 12), 60),
    );
    const dimensionLimit = Math.max(
      1,
      Math.min(Math.trunc(options.dimensionLimit ?? 20), 100),
    );
    const dueSoonDays = Math.max(
      1,
      Math.min(Math.trunc(options.dueSoonDays ?? 30), 3650),
    );

    const [
      totalsResult,
      recordTypesResult,
      statusesResult,
      publicationResult,
      activityResult,
      citedResult,
      deadlineResult,
    ] = await Promise.all([
      this.pool.query<{
        records: number | string;
        published: number | string;
      }>(
        `
          SELECT
            COUNT(*)::int AS records,
            COUNT(*) FILTER (
              WHERE record.published_at IS NOT NULL
            )::int AS published
          FROM civic_registry_records AS record
          WHERE ${where}
        `,
        values,
      ),
      this.pool.query<BucketRow>(
        `
          SELECT
            record.record_type_id AS key,
            COUNT(*)::int AS count
          FROM civic_registry_records AS record
          WHERE ${where}
          GROUP BY record.record_type_id
          ORDER BY count DESC, key ASC
        `,
        values,
      ),
      this.pool.query<BucketRow>(
        `
          SELECT
            record.status AS key,
            COUNT(*)::int AS count
          FROM civic_registry_records AS record
          WHERE ${where}
          GROUP BY record.status
          ORDER BY count DESC, key ASC
        `,
        values,
      ),
      this.pool.query<BucketRow>(
        `
          SELECT
            TO_CHAR(
              DATE_TRUNC('month', record.published_at),
              'YYYY-MM'
            ) AS key,
            COUNT(*)::int AS count
          FROM civic_registry_records AS record
          WHERE ${where}
            AND record.published_at IS NOT NULL
            AND record.published_at >=
              DATE_TRUNC('month', NOW())
              - (($${values.length + 1}::int - 1) * INTERVAL '1 month')
          GROUP BY DATE_TRUNC('month', record.published_at)
          ORDER BY key ASC
        `,
        [...values, trendMonths],
      ),
      this.pool.query<BucketRow>(
        `
          SELECT
            TO_CHAR(
              DATE_TRUNC('month', event.occurred_at),
              'YYYY-MM'
            ) AS key,
            COUNT(*)::int AS count
          FROM civic_registry_audit_events AS event
          INNER JOIN civic_registry_records AS record
            ON record.registry_id = event.registry_id
            AND record.id = event.subject_id
          WHERE ${where}
            AND event.subject_type = 'record'
            AND event.occurred_at >=
              DATE_TRUNC('month', NOW())
              - (($${values.length + 1}::int - 1) * INTERVAL '1 month')
            ${scope === "public" ? "AND event.visibility = 'public'" : ""}
          GROUP BY DATE_TRUNC('month', event.occurred_at)
          ORDER BY key ASC
        `,
        [...values, trendMonths],
      ),
      this.pool.query<CountRow>(
        `
          SELECT COUNT(DISTINCT record.id)::int AS count
          FROM civic_registry_records AS record
          INNER JOIN civic_registry_citations AS citation
            ON citation.registry_id = record.registry_id
            AND citation.record_id = record.id
          WHERE ${where}
            ${scope === "public" ? `
              AND citation.visibility = 'public'
              AND NOT EXISTS (
                SELECT 1
                FROM civic_registry_record_disclosures AS disclosure
                WHERE disclosure.registry_id = record.registry_id
                  AND disclosure.record_id = record.id
                  AND disclosure.disposition = 'withheld'
              )
            ` : ""}
        `,
        values,
      ),
      this.deadlineCounts(
        registryId,
        scope,
        options.publicStatusIds,
        options.publicDeadlineTypeIds,
        dueSoonDays,
      ),
    ]);

    const totalsRow = totalsResult.rows[0];
    const records = asCount(totalsRow?.records);
    const citedRecords = asCount(citedResult.rows[0]?.count);

    let dimension:
      | RegistryAnalytics["dimension"]
      | undefined;

    if (options.dimensionFieldId) {
      const dimensionValues = [...values];
      const dimensionWhere = [...recordWhere];

      if (options.dimensionRecordTypeId) {
        dimensionValues.push(options.dimensionRecordTypeId);
        dimensionWhere.push(
          `record.record_type_id = $${dimensionValues.length}`,
        );
      }

      dimensionValues.push(options.dimensionFieldId);
      const fieldParameter = `$${dimensionValues.length}`;
      const fieldColumn =
        scope === "public"
          ? "record.public_fields"
          : "record.fields";

      const result = await this.pool.query<BucketRow>(
        `
          SELECT
            CASE
              WHEN jsonb_typeof(${fieldColumn} -> ${fieldParameter}) = 'string'
                THEN ${fieldColumn} ->> ${fieldParameter}
              ELSE (${fieldColumn} -> ${fieldParameter})::text
            END AS key,
            COUNT(*)::int AS count
          FROM civic_registry_records AS record
          WHERE ${dimensionWhere.join(" AND ")}
            AND ${fieldColumn} ? ${fieldParameter}
            AND ${fieldColumn} -> ${fieldParameter} <> 'null'::jsonb
          GROUP BY 1
          ORDER BY count DESC, key ASC
          LIMIT ${dimensionLimit}
        `,
        dimensionValues,
      );

      dimension = {
        fieldId: options.dimensionFieldId,
        recordTypeId: options.dimensionRecordTypeId,
        values: result.rows.map((row) => ({
          key: row.key,
          count: asCount(row.count),
        })),
      };
    }

    return {
      registryId,
      scope,
      generatedAt: new Date().toISOString(),
      totals: {
        records,
        published: asCount(totalsRow?.published),
        citedRecords,
        evidenceCoveragePercent:
          records === 0
            ? 0
            : Math.round((citedRecords / records) * 1000) / 10,
      },
      recordTypes: recordTypesResult.rows.map((row) => ({
        key: row.key,
        count: asCount(row.count),
      })),
      statuses: statusesResult.rows.map((row) => ({
        key: row.key,
        count: asCount(row.count),
      })),
      publicationTrend: publicationResult.rows.map((row) => ({
        period: row.key,
        count: asCount(row.count),
      })),
      changeActivity: activityResult.rows.map((row) => ({
        period: row.key,
        count: asCount(row.count),
      })),
      deadlines: deadlineResult,
      dimension,
    };
  }

  private async deadlineCounts(
    registryId: string,
    scope: AnalyticsScope,
    publicStatusIds: string[] | undefined,
    publicDeadlineTypeIds: string[] | undefined,
    dueSoonDays: number,
  ): Promise<RegistryAnalytics["deadlines"]> {
    const values: unknown[] = [registryId, dueSoonDays];
    const where = [
      "deadline.registry_id = $1",
      "deadline.state = 'open'",
    ];

    if (scope === "public") {
      where.push("record.visibility = 'public'");

      if (publicStatusIds) {
        if (publicStatusIds.length === 0) {
          where.push("FALSE");
        } else {
          values.push([...new Set(publicStatusIds)]);
          where.push(
            `record.status = ANY($${values.length}::text[])`,
          );
        }
      }

      if (!publicDeadlineTypeIds || publicDeadlineTypeIds.length === 0) {
        where.push("FALSE");
      } else {
        values.push([...new Set(publicDeadlineTypeIds)]);
        where.push(
          `deadline.deadline_type_id = ANY($${values.length}::text[])`,
        );
      }

      where.push(`
        NOT EXISTS (
          SELECT 1
          FROM civic_registry_record_disclosures AS disclosure
          WHERE disclosure.registry_id = record.registry_id
            AND disclosure.record_id = record.id
            AND disclosure.disposition = 'withheld'
        )
      `);
    }

    const result = await this.pool.query<{
      open: number | string;
      due_soon: number | string;
      overdue: number | string;
    }>(
      `
        SELECT
          COUNT(*)::int AS open,
          COUNT(*) FILTER (
            WHERE deadline.due_at >= NOW()
              AND deadline.due_at <
                NOW() + ($2::int * INTERVAL '1 day')
          )::int AS due_soon,
          COUNT(*) FILTER (
            WHERE deadline.due_at < NOW()
          )::int AS overdue
        FROM civic_registry_deadlines AS deadline
        INNER JOIN civic_registry_records AS record
          ON record.registry_id = deadline.registry_id
          AND record.id = deadline.record_id
        WHERE ${where.join(" AND ")}
      `,
      values,
    );
    const row = result.rows[0];

    return {
      open: asCount(row?.open),
      dueSoon: asCount(row?.due_soon),
      overdue: asCount(row?.overdue),
    };
  }
}
