import {
  assertValidCitation,
  assertValidDocument,
  assertValidSource,
  type Citation,
  type Document,
  type RegistryRecord,
  type Source,
  type SourceType,
  type Visibility,
} from "@civic-registry/core";
import type {
  Pool,
  QueryResultRow,
} from "pg";

import {
  PersistenceConflictError,
  PersistenceNotFoundError,
  type RecordRepository,
  type RegistryConfigRepository,
} from "./repositories.ts";

export interface SourceListOptions {
  sourceType?: SourceType;
  visibility?: Visibility;
  limit?: number;
  offset?: number;
}

export interface DocumentListOptions {
  sourceId?: string;
  visibility?: Visibility;
  limit?: number;
  offset?: number;
}

export interface CitationListOptions {
  fieldId?: string;
  visibility?: Visibility;
  limit?: number;
  offset?: number;
}

export interface CitationEvidence {
  citation: Citation;
  source?: Source;
  document?: Document;
}

export interface SourceRepository {
  create(source: Source): Promise<Source>;
  get(registryId: string, sourceId: string): Promise<Source | null>;
  list(registryId: string, options?: SourceListOptions): Promise<Source[]>;
  update(source: Source): Promise<Source>;
  delete(registryId: string, sourceId: string): Promise<boolean>;
}

export interface DocumentRepository {
  create(document: Document): Promise<Document>;
  get(registryId: string, documentId: string): Promise<Document | null>;
  list(registryId: string, options?: DocumentListOptions): Promise<Document[]>;
  update(document: Document): Promise<Document>;
  delete(registryId: string, documentId: string): Promise<boolean>;
}

export interface CitationRepository {
  create(citation: Citation): Promise<Citation>;
  get(registryId: string, citationId: string): Promise<Citation | null>;
  listForRecord(
    registryId: string,
    recordId: string,
    options?: CitationListOptions,
  ): Promise<Citation[]>;
  listEvidenceForRecord(
    registryId: string,
    recordId: string,
    options?: CitationListOptions,
  ): Promise<CitationEvidence[]>;
  update(citation: Citation): Promise<Citation>;
  delete(registryId: string, citationId: string): Promise<boolean>;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return 100;
  return Math.max(1, Math.min(Math.trunc(limit), 500));
}

function normalizeOffset(offset: number | undefined): number {
  if (offset === undefined) return 0;
  return Math.max(0, Math.trunc(offset));
}

function databaseCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error
  ) {
    return (error as { code?: string }).code;
  }

  return undefined;
}

function translateWriteError(
  error: unknown,
  entity: string,
): never {
  if (databaseCode(error) === "23505") {
    throw new PersistenceConflictError(
      `${entity} already exists.`,
    );
  }

  if (databaseCode(error) === "23503") {
    throw new PersistenceConflictError(
      `${entity} is still referenced by other evidence records.`,
    );
  }

  throw error;
}

interface SourceRow extends QueryResultRow {
  registry_id: string;
  id: string;
  title: string;
  source_type: SourceType;
  visibility: Visibility;
  publisher_actor_id: string | null;
  canonical_url: string | null;
  published_at: Date | null;
  retrieved_at: Date | null;
  description: string | null;
  created_at: Date;
}

interface DocumentRow extends QueryResultRow {
  registry_id: string;
  id: string;
  title: string;
  visibility: Visibility;
  source_id: string | null;
  file_name: string | null;
  mime_type: string | null;
  storage_key: string | null;
  canonical_url: string | null;
  sha256: string | null;
  page_count: number | null;
  language: string | null;
  created_at: Date;
}

interface CitationRow extends QueryResultRow {
  registry_id: string;
  id: string;
  record_id: string;
  field_id: string | null;
  source_id: string | null;
  document_id: string | null;
  locator: Citation["locator"];
  note: string | null;
  visibility: Visibility;
  created_at: Date;
}

interface EvidenceJoinRow extends CitationRow {
  resolved_source_id: string | null;
  source_title: string | null;
  source_type: SourceType | null;
  source_visibility: Visibility | null;
  source_publisher_actor_id: string | null;
  source_canonical_url: string | null;
  source_published_at: Date | null;
  source_retrieved_at: Date | null;
  source_description: string | null;
  source_created_at: Date | null;
  document_title: string | null;
  document_visibility: Visibility | null;
  document_source_id: string | null;
  document_file_name: string | null;
  document_mime_type: string | null;
  document_storage_key: string | null;
  document_canonical_url: string | null;
  document_sha256: string | null;
  document_page_count: number | null;
  document_language: string | null;
  document_created_at: Date | null;
}

function mapSource(row: SourceRow): Source {
  return {
    id: row.id,
    registryId: row.registry_id,
    title: row.title,
    sourceType: row.source_type,
    visibility: row.visibility,
    publisherActorId: row.publisher_actor_id ?? undefined,
    canonicalUrl: row.canonical_url ?? undefined,
    publishedAt: row.published_at?.toISOString(),
    retrievedAt: row.retrieved_at?.toISOString(),
    description: row.description ?? undefined,
    createdAt: row.created_at.toISOString(),
  };
}

function mapDocument(row: DocumentRow): Document {
  return {
    id: row.id,
    registryId: row.registry_id,
    title: row.title,
    visibility: row.visibility,
    sourceId: row.source_id ?? undefined,
    fileName: row.file_name ?? undefined,
    mimeType: row.mime_type ?? undefined,
    storageKey: row.storage_key ?? undefined,
    canonicalUrl: row.canonical_url ?? undefined,
    sha256: row.sha256 ?? undefined,
    pageCount: row.page_count ?? undefined,
    language: row.language ?? undefined,
    createdAt: row.created_at.toISOString(),
  };
}

function mapCitation(row: CitationRow): Citation {
  return {
    id: row.id,
    registryId: row.registry_id,
    recordId: row.record_id,
    fieldId: row.field_id ?? undefined,
    sourceId: row.source_id ?? undefined,
    documentId: row.document_id ?? undefined,
    locator: row.locator ?? undefined,
    note: row.note ?? undefined,
    visibility: row.visibility,
    createdAt: row.created_at.toISOString(),
  };
}

export class PostgresSourceRepository
  implements SourceRepository
{
  private readonly pool: Pool;
  private readonly configs: RegistryConfigRepository;

  constructor(
    pool: Pool,
    configs: RegistryConfigRepository,
  ) {
    this.pool = pool;
    this.configs = configs;
  }

  private async validate(source: Source): Promise<void> {
    const config = await this.configs.get(source.registryId);

    if (!config) {
      throw new PersistenceNotFoundError(
        `Registry configuration ${source.registryId} does not exist.`,
      );
    }

    assertValidSource(source, config.registry.id);
  }

  async create(source: Source): Promise<Source> {
    await this.validate(source);

    try {
      const result = await this.pool.query<SourceRow>(
        `
          INSERT INTO civic_registry_sources (
            registry_id,
            id,
            title,
            source_type,
            visibility,
            publisher_actor_id,
            canonical_url,
            published_at,
            retrieved_at,
            description,
            created_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8::timestamptz, $9::timestamptz, $10,
            $11::timestamptz
          )
          RETURNING *
        `,
        [
          source.registryId,
          source.id,
          source.title,
          source.sourceType,
          source.visibility,
          source.publisherActorId ?? null,
          source.canonicalUrl ?? null,
          source.publishedAt ?? null,
          source.retrievedAt ?? null,
          source.description ?? null,
          source.createdAt,
        ],
      );

      return mapSource(result.rows[0]);
    } catch (error) {
      return translateWriteError(
        error,
        `Source ${source.registryId}/${source.id}`,
      );
    }
  }

  async get(
    registryId: string,
    sourceId: string,
  ): Promise<Source | null> {
    const result = await this.pool.query<SourceRow>(
      `
        SELECT *
        FROM civic_registry_sources
        WHERE registry_id = $1 AND id = $2
      `,
      [registryId, sourceId],
    );

    return result.rows[0]
      ? mapSource(result.rows[0])
      : null;
  }

  async list(
    registryId: string,
    options: SourceListOptions = {},
  ): Promise<Source[]> {
    const values: unknown[] = [registryId];
    const where = ["registry_id = $1"];

    if (options.sourceType) {
      values.push(options.sourceType);
      where.push(`source_type = $${values.length}`);
    }

    if (options.visibility) {
      values.push(options.visibility);
      where.push(`visibility = $${values.length}`);
    }

    values.push(clampLimit(options.limit));
    const limit = values.length;
    values.push(normalizeOffset(options.offset));
    const offset = values.length;

    const result = await this.pool.query<SourceRow>(
      `
        SELECT *
        FROM civic_registry_sources
        WHERE ${where.join(" AND ")}
        ORDER BY COALESCE(published_at, created_at) DESC, id ASC
        LIMIT $${limit}
        OFFSET $${offset}
      `,
      values,
    );

    return result.rows.map(mapSource);
  }

  async update(source: Source): Promise<Source> {
    await this.validate(source);

    const result = await this.pool.query<SourceRow>(
      `
        UPDATE civic_registry_sources
        SET
          title = $3,
          source_type = $4,
          visibility = $5,
          publisher_actor_id = $6,
          canonical_url = $7,
          published_at = $8::timestamptz,
          retrieved_at = $9::timestamptz,
          description = $10,
          created_at = $11::timestamptz
        WHERE registry_id = $1 AND id = $2
        RETURNING *
      `,
      [
        source.registryId,
        source.id,
        source.title,
        source.sourceType,
        source.visibility,
        source.publisherActorId ?? null,
        source.canonicalUrl ?? null,
        source.publishedAt ?? null,
        source.retrievedAt ?? null,
        source.description ?? null,
        source.createdAt,
      ],
    );

    if (!result.rows[0]) {
      throw new PersistenceNotFoundError(
        `Source ${source.registryId}/${source.id} does not exist.`,
      );
    }

    return mapSource(result.rows[0]);
  }

  async delete(
    registryId: string,
    sourceId: string,
  ): Promise<boolean> {
    try {
      const result = await this.pool.query(
        `
          DELETE FROM civic_registry_sources
          WHERE registry_id = $1 AND id = $2
        `,
        [registryId, sourceId],
      );

      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      return translateWriteError(
        error,
        `Source ${registryId}/${sourceId}`,
      );
    }
  }
}

export class PostgresDocumentRepository
  implements DocumentRepository
{
  private readonly pool: Pool;
  private readonly configs: RegistryConfigRepository;
  private readonly sources: SourceRepository;

  constructor(
    pool: Pool,
    configs: RegistryConfigRepository,
    sources: SourceRepository,
  ) {
    this.pool = pool;
    this.configs = configs;
    this.sources = sources;
  }

  private async validate(document: Document): Promise<void> {
    const config = await this.configs.get(document.registryId);

    if (!config) {
      throw new PersistenceNotFoundError(
        `Registry configuration ${document.registryId} does not exist.`,
      );
    }

    assertValidDocument(document, config.registry.id);

    if (document.sourceId) {
      const source = await this.sources.get(
        document.registryId,
        document.sourceId,
      );

      if (!source) {
        throw new PersistenceNotFoundError(
          `Source ${document.registryId}/${document.sourceId} does not exist.`,
        );
      }

      if (
        document.visibility === "public" &&
        source.visibility !== "public"
      ) {
        throw new PersistenceConflictError(
          "A public document cannot expose a non-public source.",
        );
      }
    }
  }

  async create(document: Document): Promise<Document> {
    await this.validate(document);

    try {
      const result = await this.pool.query<DocumentRow>(
        `
          INSERT INTO civic_registry_documents (
            registry_id,
            id,
            title,
            visibility,
            source_id,
            file_name,
            mime_type,
            storage_key,
            canonical_url,
            sha256,
            page_count,
            language,
            created_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8,
            $9, $10, $11, $12, $13::timestamptz
          )
          RETURNING *
        `,
        [
          document.registryId,
          document.id,
          document.title,
          document.visibility,
          document.sourceId ?? null,
          document.fileName ?? null,
          document.mimeType ?? null,
          document.storageKey ?? null,
          document.canonicalUrl ?? null,
          document.sha256 ?? null,
          document.pageCount ?? null,
          document.language ?? null,
          document.createdAt,
        ],
      );

      return mapDocument(result.rows[0]);
    } catch (error) {
      return translateWriteError(
        error,
        `Document ${document.registryId}/${document.id}`,
      );
    }
  }

  async get(
    registryId: string,
    documentId: string,
  ): Promise<Document | null> {
    const result = await this.pool.query<DocumentRow>(
      `
        SELECT *
        FROM civic_registry_documents
        WHERE registry_id = $1 AND id = $2
      `,
      [registryId, documentId],
    );

    return result.rows[0]
      ? mapDocument(result.rows[0])
      : null;
  }

  async list(
    registryId: string,
    options: DocumentListOptions = {},
  ): Promise<Document[]> {
    const values: unknown[] = [registryId];
    const where = ["registry_id = $1"];

    if (options.sourceId) {
      values.push(options.sourceId);
      where.push(`source_id = $${values.length}`);
    }

    if (options.visibility) {
      values.push(options.visibility);
      where.push(`visibility = $${values.length}`);
    }

    values.push(clampLimit(options.limit));
    const limit = values.length;
    values.push(normalizeOffset(options.offset));
    const offset = values.length;

    const result = await this.pool.query<DocumentRow>(
      `
        SELECT *
        FROM civic_registry_documents
        WHERE ${where.join(" AND ")}
        ORDER BY created_at DESC, id ASC
        LIMIT $${limit}
        OFFSET $${offset}
      `,
      values,
    );

    return result.rows.map(mapDocument);
  }

  async update(document: Document): Promise<Document> {
    await this.validate(document);

    const result = await this.pool.query<DocumentRow>(
      `
        UPDATE civic_registry_documents
        SET
          title = $3,
          visibility = $4,
          source_id = $5,
          file_name = $6,
          mime_type = $7,
          storage_key = $8,
          canonical_url = $9,
          sha256 = $10,
          page_count = $11,
          language = $12,
          created_at = $13::timestamptz
        WHERE registry_id = $1 AND id = $2
        RETURNING *
      `,
      [
        document.registryId,
        document.id,
        document.title,
        document.visibility,
        document.sourceId ?? null,
        document.fileName ?? null,
        document.mimeType ?? null,
        document.storageKey ?? null,
        document.canonicalUrl ?? null,
        document.sha256 ?? null,
        document.pageCount ?? null,
        document.language ?? null,
        document.createdAt,
      ],
    );

    if (!result.rows[0]) {
      throw new PersistenceNotFoundError(
        `Document ${document.registryId}/${document.id} does not exist.`,
      );
    }

    return mapDocument(result.rows[0]);
  }

  async delete(
    registryId: string,
    documentId: string,
  ): Promise<boolean> {
    try {
      const result = await this.pool.query(
        `
          DELETE FROM civic_registry_documents
          WHERE registry_id = $1 AND id = $2
        `,
        [registryId, documentId],
      );

      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      return translateWriteError(
        error,
        `Document ${registryId}/${documentId}`,
      );
    }
  }
}

export class PostgresCitationRepository
  implements CitationRepository
{
  private readonly pool: Pool;
  private readonly configs: RegistryConfigRepository;
  private readonly records: RecordRepository;
  private readonly sources: SourceRepository;
  private readonly documents: DocumentRepository;

  constructor(
    pool: Pool,
    configs: RegistryConfigRepository,
    records: RecordRepository,
    sources: SourceRepository,
    documents: DocumentRepository,
  ) {
    this.pool = pool;
    this.configs = configs;
    this.records = records;
    this.sources = sources;
    this.documents = documents;
  }

  private async validate(citation: Citation): Promise<{
    record: RegistryRecord;
    source?: Source;
    document?: Document;
  }> {
    const [config, record] = await Promise.all([
      this.configs.get(citation.registryId),
      this.records.get(citation.registryId, citation.recordId),
    ]);

    if (!config) {
      throw new PersistenceNotFoundError(
        `Registry configuration ${citation.registryId} does not exist.`,
      );
    }

    if (!record) {
      throw new PersistenceNotFoundError(
        `Record ${citation.registryId}/${citation.recordId} does not exist.`,
      );
    }

    assertValidCitation(citation, record, config.registry);

    const [source, document] = await Promise.all([
      citation.sourceId
        ? this.sources.get(citation.registryId, citation.sourceId)
        : Promise.resolve(null),
      citation.documentId
        ? this.documents.get(citation.registryId, citation.documentId)
        : Promise.resolve(null),
    ]);

    if (citation.sourceId && !source) {
      throw new PersistenceNotFoundError(
        `Source ${citation.registryId}/${citation.sourceId} does not exist.`,
      );
    }

    if (citation.documentId && !document) {
      throw new PersistenceNotFoundError(
        `Document ${citation.registryId}/${citation.documentId} does not exist.`,
      );
    }

    if (
      source &&
      document?.sourceId &&
      document.sourceId !== source.id
    ) {
      throw new PersistenceConflictError(
        "Citation sourceId conflicts with the document's configured source.",
      );
    }

    if (
      citation.visibility === "public" &&
      ((source && source.visibility !== "public") ||
        (document && document.visibility !== "public"))
    ) {
      throw new PersistenceConflictError(
        "A public citation cannot expose non-public source or document metadata.",
      );
    }

    if (
      document?.pageCount &&
      citation.locator?.page &&
      citation.locator.page > document.pageCount
    ) {
      throw new PersistenceConflictError(
        `Citation page ${citation.locator.page} exceeds document page count ${document.pageCount}.`,
      );
    }

    if (
      document?.pageCount &&
      citation.locator?.pageEnd &&
      citation.locator.pageEnd > document.pageCount
    ) {
      throw new PersistenceConflictError(
        `Citation pageEnd ${citation.locator.pageEnd} exceeds document page count ${document.pageCount}.`,
      );
    }

    return {
      record,
      source: source ?? undefined,
      document: document ?? undefined,
    };
  }

  async create(citation: Citation): Promise<Citation> {
    await this.validate(citation);

    try {
      const result = await this.pool.query<CitationRow>(
        `
          INSERT INTO civic_registry_citations (
            registry_id,
            id,
            record_id,
            field_id,
            source_id,
            document_id,
            locator,
            note,
            visibility,
            created_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6,
            $7::jsonb, $8, $9, $10::timestamptz
          )
          RETURNING *
        `,
        [
          citation.registryId,
          citation.id,
          citation.recordId,
          citation.fieldId ?? null,
          citation.sourceId ?? null,
          citation.documentId ?? null,
          JSON.stringify(citation.locator ?? {}),
          citation.note ?? null,
          citation.visibility,
          citation.createdAt,
        ],
      );

      return mapCitation(result.rows[0]);
    } catch (error) {
      return translateWriteError(
        error,
        `Citation ${citation.registryId}/${citation.id}`,
      );
    }
  }

  async get(
    registryId: string,
    citationId: string,
  ): Promise<Citation | null> {
    const result = await this.pool.query<CitationRow>(
      `
        SELECT *
        FROM civic_registry_citations
        WHERE registry_id = $1 AND id = $2
      `,
      [registryId, citationId],
    );

    return result.rows[0]
      ? mapCitation(result.rows[0])
      : null;
  }

  async listForRecord(
    registryId: string,
    recordId: string,
    options: CitationListOptions = {},
  ): Promise<Citation[]> {
    const values: unknown[] = [registryId, recordId];
    const where = [
      "registry_id = $1",
      "record_id = $2",
    ];

    if (options.fieldId) {
      values.push(options.fieldId);
      where.push(`field_id = $${values.length}`);
    }

    if (options.visibility) {
      values.push(options.visibility);
      where.push(`visibility = $${values.length}`);
    }

    values.push(clampLimit(options.limit));
    const limit = values.length;
    values.push(normalizeOffset(options.offset));
    const offset = values.length;

    const result = await this.pool.query<CitationRow>(
      `
        SELECT *
        FROM civic_registry_citations
        WHERE ${where.join(" AND ")}
        ORDER BY field_id NULLS FIRST, created_at ASC, id ASC
        LIMIT $${limit}
        OFFSET $${offset}
      `,
      values,
    );

    return result.rows.map(mapCitation);
  }

  async listEvidenceForRecord(
    registryId: string,
    recordId: string,
    options: CitationListOptions = {},
  ): Promise<CitationEvidence[]> {
    const values: unknown[] = [registryId, recordId];
    const where = [
      "citation.registry_id = $1",
      "citation.record_id = $2",
    ];

    if (options.fieldId) {
      values.push(options.fieldId);
      where.push(`citation.field_id = $${values.length}`);
    }

    if (options.visibility) {
      values.push(options.visibility);
      const visibility = `$${values.length}`;
      where.push(`citation.visibility = ${visibility}`);
      where.push(
        `(source.id IS NULL OR source.visibility = ${visibility})`,
      );
      where.push(
        `(document.id IS NULL OR document.visibility = ${visibility})`,
      );
    }

    values.push(clampLimit(options.limit));
    const limit = values.length;
    values.push(normalizeOffset(options.offset));
    const offset = values.length;

    const result = await this.pool.query<EvidenceJoinRow>(
      `
        SELECT
          citation.*,
          COALESCE(citation.source_id, document.source_id) AS resolved_source_id,
          source.title AS source_title,
          source.source_type AS source_type,
          source.visibility AS source_visibility,
          source.publisher_actor_id AS source_publisher_actor_id,
          source.canonical_url AS source_canonical_url,
          source.published_at AS source_published_at,
          source.retrieved_at AS source_retrieved_at,
          source.description AS source_description,
          source.created_at AS source_created_at,
          document.title AS document_title,
          document.visibility AS document_visibility,
          document.source_id AS document_source_id,
          document.file_name AS document_file_name,
          document.mime_type AS document_mime_type,
          document.storage_key AS document_storage_key,
          document.canonical_url AS document_canonical_url,
          document.sha256 AS document_sha256,
          document.page_count AS document_page_count,
          document.language AS document_language,
          document.created_at AS document_created_at
        FROM civic_registry_citations AS citation
        LEFT JOIN civic_registry_documents AS document
          ON document.registry_id = citation.registry_id
          AND document.id = citation.document_id
        LEFT JOIN civic_registry_sources AS source
          ON source.registry_id = citation.registry_id
          AND source.id = COALESCE(
            citation.source_id,
            document.source_id
          )
        WHERE ${where.join(" AND ")}
        ORDER BY citation.field_id NULLS FIRST,
          citation.created_at ASC,
          citation.id ASC
        LIMIT $${limit}
        OFFSET $${offset}
      `,
      values,
    );

    return result.rows.map((row) => {
      const source: Source | undefined =
        row.source_title &&
        row.source_type &&
        row.source_visibility &&
        row.source_created_at
          ? {
              id: row.resolved_source_id!,
              registryId: row.registry_id,
              title: row.source_title,
              sourceType: row.source_type,
              visibility: row.source_visibility,
              publisherActorId:
                row.source_publisher_actor_id ?? undefined,
              canonicalUrl:
                row.source_canonical_url ?? undefined,
              publishedAt:
                row.source_published_at?.toISOString(),
              retrievedAt:
                row.source_retrieved_at?.toISOString(),
              description:
                row.source_description ?? undefined,
              createdAt:
                row.source_created_at.toISOString(),
            }
          : undefined;

      const document: Document | undefined =
        row.document_title &&
        row.document_visibility &&
        row.document_created_at
          ? {
              id: row.document_id!,
              registryId: row.registry_id,
              title: row.document_title,
              visibility: row.document_visibility,
              sourceId:
                row.document_source_id ?? undefined,
              fileName:
                row.document_file_name ?? undefined,
              mimeType:
                row.document_mime_type ?? undefined,
              storageKey:
                row.document_storage_key ?? undefined,
              canonicalUrl:
                row.document_canonical_url ?? undefined,
              sha256:
                row.document_sha256 ?? undefined,
              pageCount:
                row.document_page_count ?? undefined,
              language:
                row.document_language ?? undefined,
              createdAt:
                row.document_created_at.toISOString(),
            }
          : undefined;

      return {
        citation: mapCitation(row),
        source,
        document,
      };
    });
  }

  async update(citation: Citation): Promise<Citation> {
    await this.validate(citation);

    const result = await this.pool.query<CitationRow>(
      `
        UPDATE civic_registry_citations
        SET
          record_id = $3,
          field_id = $4,
          source_id = $5,
          document_id = $6,
          locator = $7::jsonb,
          note = $8,
          visibility = $9,
          created_at = $10::timestamptz
        WHERE registry_id = $1 AND id = $2
        RETURNING *
      `,
      [
        citation.registryId,
        citation.id,
        citation.recordId,
        citation.fieldId ?? null,
        citation.sourceId ?? null,
        citation.documentId ?? null,
        JSON.stringify(citation.locator ?? {}),
        citation.note ?? null,
        citation.visibility,
        citation.createdAt,
      ],
    );

    if (!result.rows[0]) {
      throw new PersistenceNotFoundError(
        `Citation ${citation.registryId}/${citation.id} does not exist.`,
      );
    }

    return mapCitation(result.rows[0]);
  }

  async delete(
    registryId: string,
    citationId: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `
        DELETE FROM civic_registry_citations
        WHERE registry_id = $1 AND id = $2
      `,
      [registryId, citationId],
    );

    return (result.rowCount ?? 0) > 0;
  }
}
