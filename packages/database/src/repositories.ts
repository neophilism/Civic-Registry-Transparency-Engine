import {
  assertValidRegistryRecord,
  type RegistryRecord,
  type Relationship,
} from "@civic-registry/core";
import {
  assertValidRegistryConfig,
  compileRegistryConfig,
  type RegistryConfigFile,
} from "@civic-registry/config";
import {
  buildRecordSearchText,
} from "@civic-registry/search";
import type { Pool, QueryResultRow } from "pg";

export interface RecordCreateOptions {
  bootstrapLifecycle?: boolean;
}

export interface RecordListOptions {
  recordTypeId?: string;
  status?: string;
  statuses?: string[];
  visibility?: RegistryRecord["visibility"];
  excludeWithheld?: boolean;
  limit?: number;
  offset?: number;
}

export interface RelationshipListOptions {
  relationshipTypeId?: string;
  recordId?: string;
  direction?: "from" | "to" | "either";
  limit?: number;
  offset?: number;
}

export interface RegistryConfigRepository {
  upsert(config: RegistryConfigFile): Promise<void>;
  get(registryId: string): Promise<RegistryConfigFile | null>;
  list(): Promise<RegistryConfigFile[]>;
  delete(registryId: string): Promise<boolean>;
}

export interface RecordRepository {
  create(
    record: RegistryRecord,
    options?: RecordCreateOptions,
  ): Promise<RegistryRecord>;
  get(registryId: string, recordId: string): Promise<RegistryRecord | null>;
  list(
    registryId: string,
    options?: RecordListOptions,
  ): Promise<RegistryRecord[]>;
  update(record: RegistryRecord): Promise<RegistryRecord>;
  delete(registryId: string, recordId: string): Promise<boolean>;
}

export interface RelationshipRepository {
  create(relationship: Relationship): Promise<Relationship>;
  get(
    registryId: string,
    relationshipId: string,
  ): Promise<Relationship | null>;
  list(
    registryId: string,
    options?: RelationshipListOptions,
  ): Promise<Relationship[]>;
  delete(
    registryId: string,
    relationshipId: string,
  ): Promise<boolean>;
}

export class PersistenceConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersistenceConflictError";
  }
}

export class PersistenceNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersistenceNotFoundError";
  }
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return 100;
  return Math.max(1, Math.min(Math.trunc(limit), 500));
}

function normalizeOffset(offset: number | undefined): number {
  if (offset === undefined) return 0;
  return Math.max(0, Math.trunc(offset));
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
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

interface RelationshipRow extends QueryResultRow {
  registry_id: string;
  id: string;
  relationship_type_id: string;
  from_record_id: string;
  to_record_id: string;
  created_at: Date;
  metadata: Relationship["metadata"];
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

function mapRelationship(row: RelationshipRow): Relationship {
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

export class PostgresRegistryConfigRepository
  implements RegistryConfigRepository
{
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async upsert(config: RegistryConfigFile): Promise<void> {
    assertValidRegistryConfig(config);

    await this.pool.query(
      `
        INSERT INTO civic_registry_configurations
          (registry_id, schema_version, config)
        VALUES ($1, $2, $3::jsonb)
        ON CONFLICT (registry_id)
        DO UPDATE SET
          schema_version = EXCLUDED.schema_version,
          config = EXCLUDED.config,
          updated_at = NOW()
      `,
      [
        config.registry.id,
        config.schemaVersion,
        JSON.stringify(config),
      ],
    );
  }

  async get(registryId: string): Promise<RegistryConfigFile | null> {
    const result = await this.pool.query<{
      config: RegistryConfigFile;
    }>(
      `
        SELECT config
        FROM civic_registry_configurations
        WHERE registry_id = $1
      `,
      [registryId],
    );

    const config = result.rows[0]?.config ?? null;

    if (config) assertValidRegistryConfig(config);
    return config;
  }

  async list(): Promise<RegistryConfigFile[]> {
    const result = await this.pool.query<{
      config: RegistryConfigFile;
    }>(`
      SELECT config
      FROM civic_registry_configurations
      ORDER BY registry_id
    `);

    for (const row of result.rows) {
      assertValidRegistryConfig(row.config);
    }

    return result.rows.map((row) => row.config);
  }

  async delete(registryId: string): Promise<boolean> {
    const result = await this.pool.query(
      `
        DELETE FROM civic_registry_configurations
        WHERE registry_id = $1
      `,
      [registryId],
    );

    return (result.rowCount ?? 0) > 0;
  }
}

export class PostgresRecordRepository implements RecordRepository {
  private readonly pool: Pool;
  private readonly configs: RegistryConfigRepository;

  constructor(
    pool: Pool,
    configs: RegistryConfigRepository,
  ) {
    this.pool = pool;
    this.configs = configs;
  }

  private async validate(record: RegistryRecord): Promise<RegistryConfigFile> {
    const config = await this.configs.get(record.registryId);

    if (!config) {
      throw new PersistenceNotFoundError(
        `Registry configuration ${record.registryId} does not exist.`,
      );
    }

    assertValidRegistryRecord(record, config.registry);

    const compiled = compileRegistryConfig(config);
    const lifecycle = compiled.publicationLifecycle;

    if (
      lifecycle &&
      !lifecycle.statusesById.has(record.status)
    ) {
      throw new PersistenceConflictError(
        `Status ${record.status} is not configured in the publication lifecycle for registry ${record.registryId}.`,
      );
    }

    return config;
  }

  async create(
    record: RegistryRecord,
    options: RecordCreateOptions = {},
  ): Promise<RegistryRecord> {
    const config = await this.validate(record);
    const compiled = compileRegistryConfig(config);
    const lifecycle = compiled.publicationLifecycle;

    if (
      lifecycle &&
      !options.bootstrapLifecycle &&
      record.status !==
        lifecycle.definition.initialStatusId
    ) {
      throw new PersistenceConflictError(
        `New records in registry ${record.registryId} must begin in lifecycle status ${lifecycle.definition.initialStatusId}.`,
      );
    }

    const searchText = buildRecordSearchText(
      record,
      compiled,
    );
    const sql = `
      INSERT INTO civic_registry_records (
        registry_id,
        id,
        record_type_id,
        fields,
        status,
        visibility,
        external_identifiers,
        tags,
        created_at,
        updated_at,
        published_at,
        search_text
      )
      VALUES (
        $1, $2, $3, $4::jsonb, $5, $6, $7::jsonb,
        $8::text[], $9::timestamptz, $10::timestamptz,
        $11::timestamptz, $12
      )
      RETURNING *
    `;
    const values = [
      record.registryId,
      record.id,
      record.recordTypeId,
      JSON.stringify(record.fields),
      record.status,
      record.visibility,
      JSON.stringify(record.externalIdentifiers ?? []),
      record.tags ?? [],
      record.createdAt,
      record.updatedAt,
      record.publishedAt ?? null,
      searchText,
    ];

    try {
      if (!options.bootstrapLifecycle) {
        const result =
          await this.pool.query<RecordRow>(
            sql,
            values,
          );
        return mapRecord(result.rows[0]);
      }

      const client = await this.pool.connect();

      try {
        await client.query("BEGIN");
        await client.query(
          `
            SELECT set_config(
              'civic_registry.lifecycle_bootstrap',
              'allowed',
              true
            )
          `,
        );
        const result =
          await client.query<RecordRow>(
            sql,
            values,
          );
        await client.query("COMMIT");
        return mapRecord(result.rows[0]);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new PersistenceConflictError(
          `Record ${record.registryId}/${record.id} already exists.`,
        );
      }

      throw error;
    }
  }

  async get(
    registryId: string,
    recordId: string,
  ): Promise<RegistryRecord | null> {
    const result = await this.pool.query<RecordRow>(
      `
        SELECT *
        FROM civic_registry_records
        WHERE registry_id = $1 AND id = $2
      `,
      [registryId, recordId],
    );

    return result.rows[0] ? mapRecord(result.rows[0]) : null;
  }

  async list(
    registryId: string,
    options: RecordListOptions = {},
  ): Promise<RegistryRecord[]> {
    const values: unknown[] = [registryId];
    const where = ["registry_id = $1"];

    const addFilter = (column: string, value: unknown) => {
      values.push(value);
      where.push(`${column} = $${values.length}`);
    };

    if (options.recordTypeId) {
      addFilter("record_type_id", options.recordTypeId);
    }
    if (options.status && options.statuses?.length) {
      throw new PersistenceConflictError(
        "Record list options cannot combine status and statuses.",
      );
    }

    if (options.status) addFilter("status", options.status);

    if (options.statuses?.length) {
      values.push([
        ...new Set(
          options.statuses
            .map((status) => status.trim())
            .filter(Boolean),
        ),
      ]);
      where.push(
        `status = ANY($${values.length}::text[])`,
      );
    }

    if (options.visibility) {
      addFilter("visibility", options.visibility);
    }

    if (options.excludeWithheld) {
      where.push(`
        NOT EXISTS (
          SELECT 1
          FROM civic_registry_record_disclosures AS disclosure
          WHERE disclosure.registry_id =
            civic_registry_records.registry_id
            AND disclosure.record_id =
              civic_registry_records.id
            AND disclosure.disposition = 'withheld'
        )
      `);
    }

    values.push(clampLimit(options.limit));
    const limitIndex = values.length;
    values.push(normalizeOffset(options.offset));
    const offsetIndex = values.length;

    const result = await this.pool.query<RecordRow>(
      `
        SELECT *
        FROM civic_registry_records
        WHERE ${where.join(" AND ")}
        ORDER BY updated_at DESC, id ASC
        LIMIT $${limitIndex}
        OFFSET $${offsetIndex}
      `,
      values,
    );

    return result.rows.map(mapRecord);
  }

  async update(record: RegistryRecord): Promise<RegistryRecord> {
    const config = await this.validate(record);
    const compiled = compileRegistryConfig(config);

    if (compiled.publicationLifecycle) {
      const existing = await this.get(
        record.registryId,
        record.id,
      );

      if (!existing) {
        throw new PersistenceNotFoundError(
          `Record ${record.registryId}/${record.id} does not exist.`,
        );
      }

      if (existing.status !== record.status) {
        throw new PersistenceConflictError(
          "Status changes for lifecycle-managed registries must use the publication lifecycle service.",
        );
      }
    }

    const searchText = buildRecordSearchText(
      record,
      compiled,
    );

    const result = await this.pool.query<RecordRow>(
      `
        UPDATE civic_registry_records
        SET
          record_type_id = $3,
          fields = $4::jsonb,
          status = $5,
          visibility = $6,
          external_identifiers = $7::jsonb,
          tags = $8::text[],
          created_at = $9::timestamptz,
          updated_at = $10::timestamptz,
          published_at = $11::timestamptz,
          search_text = $12
        WHERE registry_id = $1 AND id = $2
        RETURNING *
      `,
      [
        record.registryId,
        record.id,
        record.recordTypeId,
        JSON.stringify(record.fields),
        record.status,
        record.visibility,
        JSON.stringify(record.externalIdentifiers ?? []),
        record.tags ?? [],
        record.createdAt,
        record.updatedAt,
        record.publishedAt ?? null,
        searchText,
      ],
    );

    if (!result.rows[0]) {
      throw new PersistenceNotFoundError(
        `Record ${record.registryId}/${record.id} does not exist.`,
      );
    }

    return mapRecord(result.rows[0]);
  }

  async delete(
    registryId: string,
    recordId: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `
        DELETE FROM civic_registry_records
        WHERE registry_id = $1 AND id = $2
      `,
      [registryId, recordId],
    );

    return (result.rowCount ?? 0) > 0;
  }
}

export class PostgresRelationshipRepository
  implements RelationshipRepository
{
  private readonly pool: Pool;
  private readonly configs: RegistryConfigRepository;
  private readonly records: RecordRepository;

  constructor(
    pool: Pool,
    configs: RegistryConfigRepository,
    records: RecordRepository,
  ) {
    this.pool = pool;
    this.configs = configs;
    this.records = records;
  }

  private async validate(
    relationship: Relationship,
  ): Promise<void> {
    const config = await this.configs.get(relationship.registryId);

    if (!config) {
      throw new PersistenceNotFoundError(
        `Registry configuration ${relationship.registryId} does not exist.`,
      );
    }

    const compiled = compileRegistryConfig(config);
    const type = compiled.relationshipTypesById.get(
      relationship.relationshipTypeId,
    );

    if (!type) {
      throw new Error(
        `Unknown relationship type: ${relationship.relationshipTypeId}.`,
      );
    }

    const [from, to] = await Promise.all([
      this.records.get(
        relationship.registryId,
        relationship.fromRecordId,
      ),
      this.records.get(
        relationship.registryId,
        relationship.toRecordId,
      ),
    ]);

    if (!from || !to) {
      throw new PersistenceNotFoundError(
        "Both relationship endpoints must exist before creating a relationship.",
      );
    }

    if (
      type.fromRecordTypeIds?.length &&
      !type.fromRecordTypeIds.includes(from.recordTypeId)
    ) {
      throw new Error(
        `Record type ${from.recordTypeId} is not allowed as the source of relationship ${type.id}.`,
      );
    }

    if (
      type.toRecordTypeIds?.length &&
      !type.toRecordTypeIds.includes(to.recordTypeId)
    ) {
      throw new Error(
        `Record type ${to.recordTypeId} is not allowed as the target of relationship ${type.id}.`,
      );
    }
  }

  async create(
    relationship: Relationship,
  ): Promise<Relationship> {
    await this.validate(relationship);

    try {
      const result = await this.pool.query<RelationshipRow>(
        `
          INSERT INTO civic_registry_relationships (
            registry_id,
            id,
            relationship_type_id,
            from_record_id,
            to_record_id,
            created_at,
            metadata
          )
          VALUES (
            $1, $2, $3, $4, $5,
            $6::timestamptz, $7::jsonb
          )
          RETURNING *
        `,
        [
          relationship.registryId,
          relationship.id,
          relationship.relationshipTypeId,
          relationship.fromRecordId,
          relationship.toRecordId,
          relationship.createdAt,
          JSON.stringify(relationship.metadata ?? {}),
        ],
      );

      return mapRelationship(result.rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new PersistenceConflictError(
          `Relationship ${relationship.registryId}/${relationship.id} already exists.`,
        );
      }

      throw error;
    }
  }

  async get(
    registryId: string,
    relationshipId: string,
  ): Promise<Relationship | null> {
    const result = await this.pool.query<RelationshipRow>(
      `
        SELECT *
        FROM civic_registry_relationships
        WHERE registry_id = $1 AND id = $2
      `,
      [registryId, relationshipId],
    );

    return result.rows[0]
      ? mapRelationship(result.rows[0])
      : null;
  }

  async list(
    registryId: string,
    options: RelationshipListOptions = {},
  ): Promise<Relationship[]> {
    const values: unknown[] = [registryId];
    const where = ["registry_id = $1"];

    if (options.relationshipTypeId) {
      values.push(options.relationshipTypeId);
      where.push(
        `relationship_type_id = $${values.length}`,
      );
    }

    if (options.recordId) {
      values.push(options.recordId);
      const parameter = `$${values.length}`;
      const direction = options.direction ?? "either";

      if (direction === "from") {
        where.push(`from_record_id = ${parameter}`);
      } else if (direction === "to") {
        where.push(`to_record_id = ${parameter}`);
      } else {
        where.push(
          `(from_record_id = ${parameter} OR to_record_id = ${parameter})`,
        );
      }
    }

    values.push(clampLimit(options.limit));
    const limitIndex = values.length;
    values.push(normalizeOffset(options.offset));
    const offsetIndex = values.length;

    const result = await this.pool.query<RelationshipRow>(
      `
        SELECT *
        FROM civic_registry_relationships
        WHERE ${where.join(" AND ")}
        ORDER BY created_at DESC, id ASC
        LIMIT $${limitIndex}
        OFFSET $${offsetIndex}
      `,
      values,
    );

    return result.rows.map(mapRelationship);
  }

  async delete(
    registryId: string,
    relationshipId: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `
        DELETE FROM civic_registry_relationships
        WHERE registry_id = $1 AND id = $2
      `,
      [registryId, relationshipId],
    );

    return (result.rowCount ?? 0) > 0;
  }
}
