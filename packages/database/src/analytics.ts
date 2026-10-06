import type {
  AnalyticsCount,
  AnalyticsDimensionBreakdown,
  AnalyticsEvidenceCoverage,
  AnalyticsTimeBucket,
  RegistryAnalyticsQuery,
  RegistryAnalyticsSnapshot,
} from "@civic-registry/analytics";
import type {
  AnalyticsDimensionConfig,
  CompiledRegistryConfig,
} from "@civic-registry/config";
import type {
  FieldDefinition,
  RegistryRecord,
} from "@civic-registry/core";
import type {
  Pool,
  QueryResultRow,
} from "pg";

interface CountRow extends QueryResultRow {
  id: string;
  count: number | string;
}

interface BucketRow extends QueryResultRow {
  start: string;
  count: number | string;
}

interface DeadlineRow extends QueryResultRow {
  open: number | string;
  paused: number | string;
  approaching: number | string;
  overdue: number | string;
}

interface CoverageRow extends QueryResultRow {
  record_count: number | string;
  records_with_evidence: number | string;
}

interface ScalarCountRow extends QueryResultRow {
  count: number | string;
}

interface DimensionRow extends QueryResultRow {
  value: string;
  count: number | string;
}

interface RecordLabelRow extends QueryResultRow {
  id: string;
  record_type_id: string;
  fields: RegistryRecord["fields"];
}

const MISSING_VALUE = "__missing__";

function count(value: number | string | undefined): number {
  return Number(value ?? 0);
}

function percentage(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function validDateTime(value: string | undefined): string {
  const date = value ? new Date(value) : new Date();

  if (Number.isNaN(date.valueOf())) {
    throw new Error("Analytics now must be a valid date-time.");
  }

  return date.toISOString();
}

function subtractDays(value: string, days: number): string {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}

function addDays(value: string, days: number): string {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function recordScopePredicate(alias = "r"): string {
  return `
    ${alias}.registry_id = $1
    AND (
      NOT $2::boolean
      OR (
        ${alias}.visibility = 'public'
        AND (
          NOT $4::boolean
          OR ${alias}.status = ANY($3::text[])
        )
        AND (
          NOT $5::boolean
          OR NOT EXISTS (
            SELECT 1
            FROM civic_registry_record_disclosures AS record_disclosure
            WHERE record_disclosure.registry_id = ${alias}.registry_id
              AND record_disclosure.record_id = ${alias}.id
              AND record_disclosure.disposition = 'withheld'
          )
        )
      )
    )
  `;
}

function scopeParameters(
  registry: CompiledRegistryConfig,
  query: RegistryAnalyticsQuery,
): [string, boolean, string[], boolean, boolean] {
  const publicScope = query.scope === "public";
  const lifecycle = registry.publicationLifecycle;

  return [
    registry.definition.id,
    publicScope,
    lifecycle ? [...lifecycle.publicStatusIds] : [],
    Boolean(lifecycle),
    publicScope &&
      registry.disclosure.withheldRecordBehavior === "hidden",
  ];
}

function labelCountRows(
  rows: CountRow[],
  labels: ReadonlyMap<string, string>,
): AnalyticsCount[] {
  return rows.map((row) => ({
    id: row.id,
    label: labels.get(row.id) ?? row.id,
    count: count(row.count),
  }));
}

function valueLabel(
  field: FieldDefinition,
  value: string,
): string {
  if (value === MISSING_VALUE) return "Not specified";

  if (field.type === "boolean") {
    if (value === "true") return "Yes";
    if (value === "false") return "No";
  }

  return (
    field.options?.find(
      (option) => option.value === value,
    )?.label ?? value
  );
}

export class PostgresRegistryAnalyticsRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async getSnapshot(
    registry: CompiledRegistryConfig,
    query: RegistryAnalyticsQuery,
  ): Promise<RegistryAnalyticsSnapshot> {
    const now = validDateTime(query.now);
    const analytics = registry.analytics;
    const publicationTrendDays =
      analytics.publicationTrendDays;
    const changeActivityDays =
      analytics.changeActivityDays;
    const deadlineHorizonDays =
      analytics.deadlineHorizonDays;
    const scope = scopeParameters(registry, query);
    const predicate = recordScopePredicate();

    const recordTypeLabels = new Map(
      [...registry.recordTypesById].map(
        ([id, recordType]) => [
          id,
          recordType.definition.pluralName,
        ],
      ),
    );
    const statusLabels = new Map(
      registry.publicationLifecycle
        ? [...registry.publicationLifecycle.statusesById].map(
            ([id, status]) => [id, status.label],
          )
        : [],
    );

    const [
      totalResult,
      recordTypeResult,
      statusResult,
      publicationResult,
      changeResult,
      deadlineResult,
      coverageResult,
      sourceCountResult,
      citedSourceCountResult,
    ] = await Promise.all([
      this.pool.query<ScalarCountRow>(
        `
          SELECT COUNT(*)::int AS count
          FROM civic_registry_records AS r
          WHERE ${predicate}
        `,
        scope,
      ),
      this.pool.query<CountRow>(
        `
          SELECT
            r.record_type_id AS id,
            COUNT(*)::int AS count
          FROM civic_registry_records AS r
          WHERE ${predicate}
          GROUP BY r.record_type_id
          ORDER BY count DESC, id ASC
        `,
        scope,
      ),
      this.pool.query<CountRow>(
        `
          SELECT
            r.status AS id,
            COUNT(*)::int AS count
          FROM civic_registry_records AS r
          WHERE ${predicate}
          GROUP BY r.status
          ORDER BY count DESC, id ASC
        `,
        scope,
      ),
      this.pool.query<BucketRow>(
        `
          SELECT
            to_char(
              date_trunc(
                'month',
                r.published_at AT TIME ZONE 'UTC'
              ),
              'YYYY-MM-01'
            ) AS start,
            COUNT(*)::int AS count
          FROM civic_registry_records AS r
          WHERE ${predicate}
            AND r.published_at IS NOT NULL
            AND r.published_at >= $6::timestamptz
            AND r.published_at <= $7::timestamptz
          GROUP BY 1
          ORDER BY 1
        `,
        [
          ...scope,
          subtractDays(now, publicationTrendDays),
          now,
        ],
      ),
      this.pool.query<BucketRow>(
        `
          SELECT
            to_char(
              date_trunc(
                'week',
                v.created_at AT TIME ZONE 'UTC'
              ),
              'YYYY-MM-DD'
            ) AS start,
            COUNT(*)::int AS count
          FROM civic_registry_record_versions AS v
          JOIN civic_registry_records AS r
            ON r.registry_id = v.registry_id
           AND r.id = v.record_id
          WHERE ${predicate}
            AND v.registry_id = $1
            AND v.created_at >= $6::timestamptz
            AND v.created_at <= $7::timestamptz
            AND (
              NOT $2::boolean
              OR v.visibility = 'public'
            )
          GROUP BY 1
          ORDER BY 1
        `,
        [
          ...scope,
          subtractDays(now, changeActivityDays),
          now,
        ],
      ),
      this.pool.query<DeadlineRow>(
        `
          SELECT
            COUNT(*) FILTER (
              WHERE d.state = 'open'
            )::int AS open,
            COUNT(*) FILTER (
              WHERE d.state = 'paused'
            )::int AS paused,
            COUNT(*) FILTER (
              WHERE d.state = 'open'
                AND d.due_at >= $6::timestamptz
                AND d.due_at <= $7::timestamptz
            )::int AS approaching,
            COUNT(*) FILTER (
              WHERE d.state = 'open'
                AND d.due_at < $6::timestamptz
            )::int AS overdue
          FROM civic_registry_deadlines AS d
          JOIN civic_registry_records AS r
            ON r.registry_id = d.registry_id
           AND r.id = d.record_id
          WHERE ${predicate}
            AND (
              NOT $2::boolean
              OR d.deadline_type_id = ANY($8::text[])
            )
        `,
        [
          ...scope,
          now,
          addDays(now, deadlineHorizonDays),
          registry.deadlines
            ? [...registry.deadlines.definitionsById.values()]
                .filter(
                  (definition) =>
                    definition.publiclyVisible === true,
                )
                .map((definition) => definition.id)
            : [],
        ],
      ),
      this.pool.query<CoverageRow>(
        `
          SELECT
            COUNT(*)::int AS record_count,
            COUNT(*) FILTER (
              WHERE EXISTS (
                SELECT 1
                FROM civic_registry_citations AS citation
                WHERE citation.registry_id = r.registry_id
                  AND citation.record_id = r.id
                  AND (
                    NOT $2::boolean
                    OR citation.visibility = 'public'
                  )
                  AND (
                    NOT $2::boolean
                    OR NOT EXISTS (
                      SELECT 1
                      FROM civic_registry_record_disclosures AS record_disclosure
                      WHERE record_disclosure.registry_id = r.registry_id
                        AND record_disclosure.record_id = r.id
                        AND record_disclosure.disposition = 'withheld'
                    )
                  )
              )
            )::int AS records_with_evidence
          FROM civic_registry_records AS r
          WHERE ${predicate}
        `,
        scope,
      ),
      this.pool.query<ScalarCountRow>(
        `
          SELECT COUNT(*)::int AS count
          FROM civic_registry_sources AS source
          WHERE source.registry_id = $1
            AND (
              NOT $2::boolean
              OR source.visibility = 'public'
            )
        `,
        scope,
      ),
      this.pool.query<ScalarCountRow>(
        `
          SELECT COUNT(DISTINCT source_id)::int AS count
          FROM (
            SELECT citation.source_id
            FROM civic_registry_citations AS citation
            JOIN civic_registry_sources AS source
              ON source.registry_id = citation.registry_id
             AND source.id = citation.source_id
            JOIN civic_registry_records AS r
              ON r.registry_id = citation.registry_id
             AND r.id = citation.record_id
            WHERE ${predicate}
              AND citation.source_id IS NOT NULL
              AND (
                NOT $2::boolean
                OR (
                  citation.visibility = 'public'
                  AND source.visibility = 'public'
                )
              )

            UNION

            SELECT document.source_id
            FROM civic_registry_citations AS citation
            JOIN civic_registry_documents AS document
              ON document.registry_id = citation.registry_id
             AND document.id = citation.document_id
            JOIN civic_registry_sources AS source
              ON source.registry_id = document.registry_id
             AND source.id = document.source_id
            JOIN civic_registry_records AS r
              ON r.registry_id = citation.registry_id
             AND r.id = citation.record_id
            WHERE ${predicate}
              AND document.source_id IS NOT NULL
              AND (
                NOT $2::boolean
                OR (
                  citation.visibility = 'public'
                  AND document.visibility = 'public'
                  AND source.visibility = 'public'
                )
              )
          ) AS cited
        `,
        scope,
      ),
    ]);

    const recordCount =
      count(coverageResult.rows[0]?.record_count);
    const recordsWithEvidence =
      count(
        coverageResult.rows[0]
          ?.records_with_evidence,
      );
    const sourceCount =
      count(sourceCountResult.rows[0]?.count);
    const citedSourceCount =
      count(citedSourceCountResult.rows[0]?.count);

    const evidenceCoverage: AnalyticsEvidenceCoverage = {
      recordCount,
      recordsWithEvidence,
      recordsWithoutEvidence:
        Math.max(0, recordCount - recordsWithEvidence),
      recordCoveragePercent: percentage(
        recordsWithEvidence,
        recordCount,
      ),
      sourceCount,
      citedSourceCount,
      sourceCoveragePercent: percentage(
        citedSourceCount,
        sourceCount,
      ),
    };

    const dimensions =
      await this.dimensionBreakdowns(
        registry,
        query,
        scope,
      );

    return {
      registryId: registry.definition.id,
      scope: query.scope,
      generatedAt: now,
      totalRecords:
        count(totalResult.rows[0]?.count),
      publicationTrendWindowDays:
        publicationTrendDays,
      changeActivityWindowDays:
        changeActivityDays,
      byRecordType: labelCountRows(
        recordTypeResult.rows,
        recordTypeLabels,
      ),
      byStatus: labelCountRows(
        statusResult.rows,
        statusLabels,
      ),
      publicationTrend: publicationResult.rows.map(
        (row): AnalyticsTimeBucket => ({
          start: row.start,
          count: count(row.count),
        }),
      ),
      changeActivity: changeResult.rows.map(
        (row): AnalyticsTimeBucket => ({
          start: row.start,
          count: count(row.count),
        }),
      ),
      deadlines: {
        open: count(deadlineResult.rows[0]?.open),
        paused:
          count(deadlineResult.rows[0]?.paused),
        approaching:
          count(
            deadlineResult.rows[0]?.approaching,
          ),
        overdue:
          count(deadlineResult.rows[0]?.overdue),
        horizonDays: deadlineHorizonDays,
      },
      evidenceCoverage,
      dimensions,
    };
  }

  private async dimensionBreakdowns(
    registry: CompiledRegistryConfig,
    query: RegistryAnalyticsQuery,
    scope: [string, boolean, string[], boolean, boolean],
  ): Promise<AnalyticsDimensionBreakdown[]> {
    const dimensions =
      registry.analytics.dimensions.filter(
        (dimension) =>
          query.scope === "administrative" ||
          dimension.publiclyVisible === true,
      );

    return Promise.all(
      dimensions.map((dimension) =>
        this.dimensionBreakdown(
          registry,
          query,
          scope,
          dimension,
        ),
      ),
    );
  }

  private async dimensionBreakdown(
    registry: CompiledRegistryConfig,
    query: RegistryAnalyticsQuery,
    scope: [string, boolean, string[], boolean, boolean],
    dimension: AnalyticsDimensionConfig,
  ): Promise<AnalyticsDimensionBreakdown> {
    const predicate = recordScopePredicate();
    const result = await this.pool.query<DimensionRow>(
      `
        SELECT
          COALESCE(
            NULLIF(r.fields ->> $6, ''),
            '${MISSING_VALUE}'
          ) AS value,
          COUNT(*)::int AS count
        FROM civic_registry_records AS r
        WHERE ${predicate}
          AND r.record_type_id = $7
          AND (
            NOT $2::boolean
            OR (
              NOT EXISTS (
                SELECT 1
                FROM civic_registry_record_disclosures AS record_disclosure
                WHERE record_disclosure.registry_id = r.registry_id
                  AND record_disclosure.record_id = r.id
                  AND record_disclosure.disposition = 'withheld'
              )
              AND NOT EXISTS (
                SELECT 1
                FROM civic_registry_field_disclosures AS field_disclosure
                WHERE field_disclosure.registry_id = r.registry_id
                  AND field_disclosure.record_id = r.id
                  AND field_disclosure.field_id = $6
              )
            )
          )
        GROUP BY 1
        ORDER BY count DESC, value ASC
        LIMIT $8
      `,
      [
        ...scope,
        dimension.fieldId,
        dimension.recordTypeId,
        dimension.limit,
      ],
    );

    const recordType =
      registry.getRecordType(
        dimension.recordTypeId,
      );
    const field =
      recordType.fieldsById.get(dimension.fieldId)!;
    const labels = await this.dimensionLabels(
      registry,
      query,
      scope,
      field,
      result.rows.map((row) => row.value),
    );
    const shownCount = result.rows.reduce(
      (sum, row) => sum + count(row.count),
      0,
    );

    const eligible = await this.pool.query<ScalarCountRow>(
      `
        SELECT COUNT(*)::int AS count
        FROM civic_registry_records AS r
        WHERE ${predicate}
          AND r.record_type_id = $6
          AND (
            NOT $2::boolean
            OR (
              NOT EXISTS (
                SELECT 1
                FROM civic_registry_record_disclosures AS record_disclosure
                WHERE record_disclosure.registry_id = r.registry_id
                  AND record_disclosure.record_id = r.id
                  AND record_disclosure.disposition = 'withheld'
              )
              AND NOT EXISTS (
                SELECT 1
                FROM civic_registry_field_disclosures AS field_disclosure
                WHERE field_disclosure.registry_id = r.registry_id
                  AND field_disclosure.record_id = r.id
                  AND field_disclosure.field_id = $7
              )
            )
          )
      `,
      [
        ...scope,
        dimension.recordTypeId,
        dimension.fieldId,
      ],
    );
    const eligibleCount =
      count(eligible.rows[0]?.count);

    return {
      id: dimension.id,
      label: dimension.label,
      recordTypeId: dimension.recordTypeId,
      fieldId: dimension.fieldId,
      values: result.rows.map((row) => ({
        id: row.value,
        label:
          labels.get(row.value) ??
          valueLabel(field, row.value),
        count: count(row.count),
      })),
      suppressedCount:
        Math.max(0, eligibleCount - shownCount),
    };
  }

  private async dimensionLabels(
    registry: CompiledRegistryConfig,
    query: RegistryAnalyticsQuery,
    scope: [string, boolean, string[], boolean, boolean],
    field: FieldDefinition,
    values: string[],
  ): Promise<Map<string, string>> {
    const labels = new Map<string, string>();

    for (const value of values) {
      labels.set(value, valueLabel(field, value));
    }

    if (field.type !== "entityRef") {
      return labels;
    }

    const ids = [
      ...new Set(
        values.filter(
          (value) => value !== MISSING_VALUE,
        ),
      ),
    ];

    if (ids.length === 0) return labels;

    const predicate = recordScopePredicate("label_record");
    const result = await this.pool.query<RecordLabelRow>(
      `
        SELECT
          label_record.id,
          label_record.record_type_id,
          label_record.fields
        FROM civic_registry_records AS label_record
        WHERE ${predicate}
          AND label_record.id = ANY($6::text[])
      `,
      [...scope, ids],
    );

    if (query.scope === "public") {
      for (const id of ids) {
        if (
          !result.rows.some((row) => row.id === id)
        ) {
          labels.set(id, "Unavailable");
        }
      }
    }

    for (const row of result.rows) {
      const recordType =
        registry.recordTypesById.get(
          row.record_type_id,
        );
      const titleFieldId =
        recordType?.definition.titleFieldId;
      const title = titleFieldId
        ? row.fields[titleFieldId]
        : undefined;

      if (
        typeof title === "string" &&
        title.trim().length > 0
      ) {
        labels.set(row.id, title);
      }
    }

    return labels;
  }
}
