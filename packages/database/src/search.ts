import type {
  CompiledRegistryConfig,
  CompiledRecordTypeConfig,
} from "@civic-registry/config";
import type {
  FieldDefinition,
  RegistryRecord,
} from "@civic-registry/core";
import {
  normalizeSearchRequest,
  type NormalizedSearchRequest,
  type SearchFacet,
  type SearchFacetBucket,
  type SearchProvider,
  type SearchRequest,
  type SearchResponse,
} from "@civic-registry/search";
import type {
  Pool,
  QueryResultRow,
} from "pg";

interface SearchRecordRow extends QueryResultRow {
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
  score: number | string | null;
  total: number | string;
}

interface CountRow extends QueryResultRow {
  value: string;
  count: number | string;
}

interface RangeRow extends QueryResultRow {
  min: string | number | Date | null;
  max: string | number | Date | null;
}

interface WhereClause {
  sql: string;
  values: unknown[];
  textQueryParameter?: string;
}

class SqlParameters {
  readonly values: unknown[] = [];

  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

function mapRecord(row: SearchRecordRow): RegistryRecord {
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

function rangeCast(field: FieldDefinition): string {
  switch (field.type) {
    case "date":
      return "date";
    case "datetime":
      return "timestamptz";
    case "integer":
    case "decimal":
      return "numeric";
    default:
      throw new Error(
        `Field ${field.id} does not support range filtering.`,
      );
  }
}

function fieldSortExpression(
  field: FieldDefinition,
  keyParameter: string,
): string {
  const raw = `NULLIF(fields ->> ${keyParameter}, '')`;

  switch (field.type) {
    case "integer":
    case "decimal":
      return `(${raw})::numeric`;
    case "date":
      return `(${raw})::date`;
    case "datetime":
      return `(${raw})::timestamptz`;
    case "boolean":
      return `(${raw})::boolean`;
    default:
      return `LOWER(${raw})`;
  }
}

function buildWhere(
  registry: CompiledRegistryConfig,
  request: NormalizedSearchRequest,
): WhereClause {
  const parameters = new SqlParameters();
  const clauses: string[] = [];
  const registryParameter = parameters.add(request.registryId);
  clauses.push(`registry_id = ${registryParameter}`);

  if (request.visibility) {
    const parameter = parameters.add(request.visibility);
    clauses.push(`visibility = ${parameter}`);
  }

  if (request.recordTypeId) {
    const parameter = parameters.add(request.recordTypeId);
    clauses.push(`record_type_id = ${parameter}`);
  }

  let textQueryParameter: string | undefined;

  if (request.text) {
    textQueryParameter = parameters.add(request.text);
    clauses.push(
      `search_document @@ websearch_to_tsquery('simple', ${textQueryParameter})`,
    );
  }

  if (request.statuses.length > 0) {
    const parameter = parameters.add(request.statuses);
    clauses.push(`status = ANY(${parameter}::text[])`);
  }

  if (request.tags.length > 0) {
    const parameter = parameters.add(request.tags);
    clauses.push(`tags && ${parameter}::text[]`);
  }

  const recordType = request.recordTypeId
    ? registry.getRecordType(request.recordTypeId)
    : undefined;

  for (const filter of request.fieldFilters) {
    const field = recordType!.fieldsById.get(filter.fieldId)!;
    const key = parameters.add(filter.fieldId);
    const values = parameters.add(filter.values);

    if (
      field.type === "multiEnum" ||
      field.type === "entityRefList"
    ) {
      clauses.push(`
        EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(
            CASE
              WHEN jsonb_typeof(fields -> ${key}) = 'array'
                THEN fields -> ${key}
              ELSE '[]'::jsonb
            END
          ) AS selected(value)
          WHERE selected.value = ANY(${values}::text[])
        )
      `);
    } else {
      clauses.push(
        `fields ->> ${key} = ANY(${values}::text[])`,
      );
    }
  }

  for (const range of request.rangeFilters) {
    const field = recordType!.fieldsById.get(range.fieldId)!;
    const key = parameters.add(range.fieldId);
    const cast = rangeCast(field);
    const expression =
      `NULLIF(fields ->> ${key}, '')::${cast}`;

    if (range.from) {
      const from = parameters.add(range.from);
      clauses.push(`${expression} >= ${from}::${cast}`);
    }

    if (range.to) {
      const to = parameters.add(range.to);
      clauses.push(`${expression} <= ${to}::${cast}`);
    }
  }

  return {
    sql: clauses.join(" AND "),
    values: parameters.values,
    textQueryParameter,
  };
}

function effectiveSort(
  registry: CompiledRegistryConfig,
  request: NormalizedSearchRequest,
): {
  by: "relevance" | "updated" | "published" | "field";
  fieldId?: string;
  direction: "asc" | "desc";
} {
  if (request.sort) {
    return {
      by: request.sort.by,
      fieldId: request.sort.fieldId,
      direction:
        request.sort.direction ??
        (request.sort.by === "relevance" ? "desc" : "asc"),
    };
  }

  if (request.text) {
    return {
      by: "relevance",
      direction: "desc",
    };
  }

  if (request.recordTypeId) {
    const configured = registry.getRecordType(
      request.recordTypeId,
    ).defaultSort;

    if (configured) {
      return {
        by: "field",
        fieldId: configured.fieldId,
        direction: configured.direction,
      };
    }
  }

  return {
    by: "updated",
    direction: "desc",
  };
}

function addSort(
  registry: CompiledRegistryConfig,
  request: NormalizedSearchRequest,
  where: WhereClause,
  values: unknown[],
): string {
  const sort = effectiveSort(registry, request);
  const direction = sort.direction === "desc" ? "DESC" : "ASC";

  if (sort.by === "relevance" && where.textQueryParameter) {
    return `score DESC, updated_at DESC, id ASC`;
  }

  if (sort.by === "published") {
    return `published_at ${direction} NULLS LAST, id ASC`;
  }

  if (sort.by === "updated") {
    return `updated_at ${direction}, id ASC`;
  }

  if (sort.by === "field" && sort.fieldId && request.recordTypeId) {
    const recordType = registry.getRecordType(
      request.recordTypeId,
    );
    const field = recordType.fieldsById.get(sort.fieldId)!;
    values.push(sort.fieldId);
    const key = `$${values.length}`;
    const expression = fieldSortExpression(field, key);
    return `${expression} ${direction} NULLS LAST, id ASC`;
  }

  return "updated_at DESC, id ASC";
}

async function termsFacet(
  pool: Pool,
  fromSql: string,
  where: WhereClause,
  valueExpression: string,
  extraValues: unknown[] = [],
): Promise<SearchFacetBucket[]> {
  const result = await pool.query<CountRow>(
    `
      SELECT ${valueExpression} AS value, COUNT(*)::int AS count
      ${fromSql}
      WHERE ${where.sql}
      GROUP BY value
      HAVING ${valueExpression} IS NOT NULL
      ORDER BY count DESC, value ASC
      LIMIT 50
    `,
    [...where.values, ...extraValues],
  );

  return result.rows.map((row) => ({
    value: row.value,
    count: Number(row.count),
  }));
}

function termFacetSql(
  field: FieldDefinition,
  keyParameter: string,
): {
  fromSuffix: string;
  valueExpression: string;
} {
  if (
    field.type === "multiEnum" ||
    field.type === "entityRefList"
  ) {
    return {
      fromSuffix: `
        CROSS JOIN LATERAL jsonb_array_elements_text(
          CASE
            WHEN jsonb_typeof(fields -> ${keyParameter}) = 'array'
              THEN fields -> ${keyParameter}
            ELSE '[]'::jsonb
          END
        ) AS facet_value(value)
      `,
      valueExpression: "facet_value.value",
    };
  }

  return {
    fromSuffix: "",
    valueExpression: `fields ->> ${keyParameter}`,
  };
}

function isRangeField(field: FieldDefinition): boolean {
  return (
    field.type === "date" ||
    field.type === "datetime" ||
    field.type === "integer" ||
    field.type === "decimal"
  );
}

function formatRangeValue(
  value: string | number | Date | null,
): string | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export class PostgresSearchProvider implements SearchProvider {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async search(
    registry: CompiledRegistryConfig,
    input: SearchRequest,
  ): Promise<SearchResponse> {
    const request = normalizeSearchRequest(
      registry,
      input,
    );
    const where = buildWhere(registry, request);
    const values = [...where.values];
    const scoreExpression = where.textQueryParameter
      ? `ts_rank_cd(
          search_document,
          websearch_to_tsquery('simple', ${where.textQueryParameter})
        )`
      : "0::real";
    const orderBy = addSort(
      registry,
      request,
      where,
      values,
    );

    values.push(request.pageSize);
    const limitParameter = `$${values.length}`;
    values.push((request.page - 1) * request.pageSize);
    const offsetParameter = `$${values.length}`;

    const result = await this.pool.query<SearchRecordRow>(
      `
        SELECT
          *,
          ${scoreExpression} AS score,
          COUNT(*) OVER()::int AS total
        FROM civic_registry_records
        WHERE ${where.sql}
        ORDER BY ${orderBy}
        LIMIT ${limitParameter}
        OFFSET ${offsetParameter}
      `,
      values,
    );

    const baseFrom = "FROM civic_registry_records";

    const [recordTypes, statuses, tags] = await Promise.all([
      termsFacet(
        this.pool,
        baseFrom,
        where,
        "record_type_id",
      ),
      termsFacet(
        this.pool,
        baseFrom,
        where,
        "status",
      ),
      termsFacet(
        this.pool,
        `${baseFrom}
          CROSS JOIN LATERAL unnest(tags) AS tag(value)`,
        where,
        "tag.value",
      ),
    ]);

    const fields: Record<string, SearchFacet> = {};

    if (request.recordTypeId) {
      const recordType = registry.getRecordType(
        request.recordTypeId,
      );
      const filterable = recordType.definition.fields.filter(
        (field) => field.filterable,
      );

      await Promise.all(
        filterable.map(async (field) => {
          const valuesForFacet = [...where.values, field.id];
          const key = `$${valuesForFacet.length}`;

          if (isRangeField(field)) {
            const cast = rangeCast(field);
            const expression =
              `NULLIF(fields ->> ${key}, '')::${cast}`;
            const range = await this.pool.query<RangeRow>(
              `
                SELECT
                  MIN(${expression}) AS min,
                  MAX(${expression}) AS max
                FROM civic_registry_records
                WHERE ${where.sql}
              `,
              valuesForFacet,
            );
            fields[field.id] = {
              kind: "range",
              id: field.id,
              label: field.label,
              min: formatRangeValue(range.rows[0]?.min ?? null),
              max: formatRangeValue(range.rows[0]?.max ?? null),
            };
            return;
          }

          const sql = termFacetSql(field, key);
          const buckets = await termsFacet(
            this.pool,
            `${baseFrom}${sql.fromSuffix}`,
            where,
            sql.valueExpression,
            [field.id],
          );
          fields[field.id] = {
            kind: "terms",
            id: field.id,
            label: field.label,
            buckets,
          };
        }),
      );
    }

    return {
      hits: result.rows.map((row) => ({
        record: mapRecord(row),
        score:
          row.score === null ? null : Number(row.score),
      })),
      total: result.rows[0]
        ? Number(result.rows[0].total)
        : 0,
      page: request.page,
      pageSize: request.pageSize,
      facets: {
        recordTypes,
        statuses,
        tags,
        fields,
      },
    };
  }
}
