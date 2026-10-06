import {
  type DocumentDisclosure,
  type DocumentRedaction,
  type FieldDisclosure,
  type RecordDisclosure,
} from "@civic-registry/core";
import {
  compileRegistryConfig,
} from "@civic-registry/config";
import type {
  Pool,
  QueryResultRow,
} from "pg";

import type {
  DocumentRepository,
} from "./evidence.ts";
import {
  PersistenceConflictError,
  PersistenceNotFoundError,
  type RecordRepository,
  type RegistryConfigRepository,
} from "./repositories.ts";

export interface RecordDisclosureBundle {
  record?: RecordDisclosure;
  fields: FieldDisclosure[];
}

export interface DocumentDisclosureBundle {
  document?: DocumentDisclosure;
  redactions: DocumentRedaction[];
}

export interface DisclosureRepository {
  getRecordDisclosure(
    registryId: string,
    recordId: string,
  ): Promise<RecordDisclosure | null>;
  listFieldDisclosures(
    registryId: string,
    recordId: string,
  ): Promise<FieldDisclosure[]>;
  getRecordBundle(
    registryId: string,
    recordId: string,
  ): Promise<RecordDisclosureBundle>;
  setRecordDisclosure(
    disclosure: RecordDisclosure,
  ): Promise<RecordDisclosure>;
  clearRecordDisclosure(
    registryId: string,
    recordId: string,
  ): Promise<boolean>;
  setFieldDisclosure(
    disclosure: FieldDisclosure,
  ): Promise<FieldDisclosure>;
  clearFieldDisclosure(
    registryId: string,
    recordId: string,
    fieldId: string,
  ): Promise<boolean>;
  getDocumentDisclosure(
    registryId: string,
    documentId: string,
  ): Promise<DocumentDisclosure | null>;
  listDocumentRedactions(
    registryId: string,
    documentId: string,
  ): Promise<DocumentRedaction[]>;
  getDocumentBundle(
    registryId: string,
    documentId: string,
  ): Promise<DocumentDisclosureBundle>;
  setDocumentDisclosure(
    disclosure: DocumentDisclosure,
  ): Promise<DocumentDisclosure>;
  clearDocumentDisclosure(
    registryId: string,
    documentId: string,
  ): Promise<boolean>;
  upsertDocumentRedaction(
    redaction: DocumentRedaction,
  ): Promise<DocumentRedaction>;
  deleteDocumentRedaction(
    registryId: string,
    redactionId: string,
  ): Promise<boolean>;
}

interface RecordDisclosureRow extends QueryResultRow {
  registry_id: string;
  record_id: string;
  disposition: RecordDisclosure["disposition"];
  reason: string | null;
  authority: string | null;
  public_note: string | null;
  updated_at: Date;
  actor_id: string | null;
}

interface FieldDisclosureRow extends QueryResultRow {
  registry_id: string;
  record_id: string;
  field_id: string;
  disposition: FieldDisclosure["disposition"];
  replacement_text: string | null;
  reason: string | null;
  authority: string | null;
  public_note: string | null;
  updated_at: Date;
  actor_id: string | null;
}

interface DocumentDisclosureRow extends QueryResultRow {
  registry_id: string;
  document_id: string;
  disposition: DocumentDisclosure["disposition"];
  public_canonical_url: string | null;
  public_storage_key: string | null;
  reason: string | null;
  authority: string | null;
  public_note: string | null;
  updated_at: Date;
  actor_id: string | null;
}

interface DocumentRedactionRow extends QueryResultRow {
  registry_id: string;
  id: string;
  document_id: string;
  locator: DocumentRedaction["locator"];
  replacement_text: string | null;
  reason: string | null;
  authority: string | null;
  public_note: string | null;
  created_at: Date;
  actor_id: string | null;
}

function mapRecordDisclosure(
  row: RecordDisclosureRow,
): RecordDisclosure {
  return {
    registryId: row.registry_id,
    recordId: row.record_id,
    disposition: row.disposition,
    reason: row.reason ?? undefined,
    authority: row.authority ?? undefined,
    publicNote: row.public_note ?? undefined,
    updatedAt: row.updated_at.toISOString(),
    actorId: row.actor_id ?? undefined,
  };
}

function mapFieldDisclosure(
  row: FieldDisclosureRow,
): FieldDisclosure {
  return {
    registryId: row.registry_id,
    recordId: row.record_id,
    fieldId: row.field_id,
    disposition: row.disposition,
    replacementText:
      row.replacement_text ?? undefined,
    reason: row.reason ?? undefined,
    authority: row.authority ?? undefined,
    publicNote: row.public_note ?? undefined,
    updatedAt: row.updated_at.toISOString(),
    actorId: row.actor_id ?? undefined,
  };
}

function mapDocumentDisclosure(
  row: DocumentDisclosureRow,
): DocumentDisclosure {
  return {
    registryId: row.registry_id,
    documentId: row.document_id,
    disposition: row.disposition,
    publicCanonicalUrl:
      row.public_canonical_url ?? undefined,
    publicStorageKey:
      row.public_storage_key ?? undefined,
    reason: row.reason ?? undefined,
    authority: row.authority ?? undefined,
    publicNote: row.public_note ?? undefined,
    updatedAt: row.updated_at.toISOString(),
    actorId: row.actor_id ?? undefined,
  };
}

function mapDocumentRedaction(
  row: DocumentRedactionRow,
): DocumentRedaction {
  return {
    id: row.id,
    registryId: row.registry_id,
    documentId: row.document_id,
    locator: row.locator ?? undefined,
    replacementText:
      row.replacement_text ?? undefined,
    reason: row.reason ?? undefined,
    authority: row.authority ?? undefined,
    publicNote: row.public_note ?? undefined,
    createdAt: row.created_at.toISOString(),
    actorId: row.actor_id ?? undefined,
  };
}

function requireDateTime(
  value: string,
  label: string,
): void {
  if (Number.isNaN(Date.parse(value))) {
    throw new PersistenceConflictError(
      `${label} must be a valid date-time.`,
    );
  }
}

function optionalNonEmpty(
  value: string | undefined,
  label: string,
): void {
  if (
    value !== undefined &&
    value.trim().length === 0
  ) {
    throw new PersistenceConflictError(
      `${label} must be non-empty when provided.`,
    );
  }
}

function optionalHttpUrl(
  value: string | undefined,
  label: string,
): void {
  if (value === undefined) return;

  try {
    const url = new URL(value);

    if (
      url.protocol !== "http:" &&
      url.protocol !== "https:"
    ) {
      throw new Error("unsupported protocol");
    }
  } catch {
    throw new PersistenceConflictError(
      `${label} must use http or https.`,
    );
  }
}

export class PostgresDisclosureRepository
  implements DisclosureRepository
{
  private readonly pool: Pool;
  private readonly configs: RegistryConfigRepository;
  private readonly records: RecordRepository;
  private readonly documents: DocumentRepository;

  constructor(
    pool: Pool,
    configs: RegistryConfigRepository,
    records: RecordRepository,
    documents: DocumentRepository,
  ) {
    this.pool = pool;
    this.configs = configs;
    this.records = records;
    this.documents = documents;
  }

  private async requireRecord(
    registryId: string,
    recordId: string,
  ) {
    const record = await this.records.get(
      registryId,
      recordId,
    );

    if (!record) {
      throw new PersistenceNotFoundError(
        `Record ${registryId}/${recordId} does not exist.`,
      );
    }

    return record;
  }

  private async requireDocument(
    registryId: string,
    documentId: string,
  ) {
    const document = await this.documents.get(
      registryId,
      documentId,
    );

    if (!document) {
      throw new PersistenceNotFoundError(
        `Document ${registryId}/${documentId} does not exist.`,
      );
    }

    return document;
  }

  async getRecordDisclosure(
    registryId: string,
    recordId: string,
  ): Promise<RecordDisclosure | null> {
    const result =
      await this.pool.query<RecordDisclosureRow>(
        `
          SELECT *
          FROM civic_registry_record_disclosures
          WHERE registry_id = $1
            AND record_id = $2
        `,
        [registryId, recordId],
      );

    return result.rows[0]
      ? mapRecordDisclosure(result.rows[0])
      : null;
  }

  async listFieldDisclosures(
    registryId: string,
    recordId: string,
  ): Promise<FieldDisclosure[]> {
    const result =
      await this.pool.query<FieldDisclosureRow>(
        `
          SELECT *
          FROM civic_registry_field_disclosures
          WHERE registry_id = $1
            AND record_id = $2
          ORDER BY field_id
        `,
        [registryId, recordId],
      );

    return result.rows.map(mapFieldDisclosure);
  }

  async getRecordBundle(
    registryId: string,
    recordId: string,
  ): Promise<RecordDisclosureBundle> {
    const [record, fields] = await Promise.all([
      this.getRecordDisclosure(
        registryId,
        recordId,
      ),
      this.listFieldDisclosures(
        registryId,
        recordId,
      ),
    ]);

    return {
      record: record ?? undefined,
      fields,
    };
  }

  async setRecordDisclosure(
    disclosure: RecordDisclosure,
  ): Promise<RecordDisclosure> {
    await this.requireRecord(
      disclosure.registryId,
      disclosure.recordId,
    );
    requireDateTime(
      disclosure.updatedAt,
      "updatedAt",
    );
    optionalNonEmpty(
      disclosure.reason,
      "reason",
    );
    optionalNonEmpty(
      disclosure.authority,
      "authority",
    );
    optionalNonEmpty(
      disclosure.publicNote,
      "publicNote",
    );

    const result =
      await this.pool.query<RecordDisclosureRow>(
        `
          INSERT INTO civic_registry_record_disclosures (
            registry_id,
            record_id,
            disposition,
            reason,
            authority,
            public_note,
            updated_at,
            actor_id
          )
          VALUES (
            $1, $2, $3, $4, $5, $6,
            $7::timestamptz, $8
          )
          ON CONFLICT (registry_id, record_id)
          DO UPDATE SET
            disposition = EXCLUDED.disposition,
            reason = EXCLUDED.reason,
            authority = EXCLUDED.authority,
            public_note = EXCLUDED.public_note,
            updated_at = EXCLUDED.updated_at,
            actor_id = EXCLUDED.actor_id
          RETURNING *
        `,
        [
          disclosure.registryId,
          disclosure.recordId,
          disclosure.disposition,
          disclosure.reason ?? null,
          disclosure.authority ?? null,
          disclosure.publicNote ?? null,
          disclosure.updatedAt,
          disclosure.actorId ?? null,
        ],
      );

    return mapRecordDisclosure(result.rows[0]);
  }

  async clearRecordDisclosure(
    registryId: string,
    recordId: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `
        DELETE FROM civic_registry_record_disclosures
        WHERE registry_id = $1
          AND record_id = $2
      `,
      [registryId, recordId],
    );

    return (result.rowCount ?? 0) > 0;
  }

  async setFieldDisclosure(
    disclosure: FieldDisclosure,
  ): Promise<FieldDisclosure> {
    const record = await this.requireRecord(
      disclosure.registryId,
      disclosure.recordId,
    );
    const config = await this.configs.get(
      disclosure.registryId,
    );

    if (!config) {
      throw new PersistenceNotFoundError(
        `Registry configuration ${disclosure.registryId} does not exist.`,
      );
    }

    const registry = compileRegistryConfig(config);

    if (
      !registry
        .getRecordType(record.recordTypeId)
        .fieldsById.has(disclosure.fieldId)
    ) {
      throw new PersistenceConflictError(
        `Field ${disclosure.fieldId} does not exist on record type ${record.recordTypeId}.`,
      );
    }

    requireDateTime(
      disclosure.updatedAt,
      "updatedAt",
    );
    optionalNonEmpty(
      disclosure.replacementText,
      "replacementText",
    );
    optionalNonEmpty(
      disclosure.reason,
      "reason",
    );
    optionalNonEmpty(
      disclosure.authority,
      "authority",
    );
    optionalNonEmpty(
      disclosure.publicNote,
      "publicNote",
    );

    const result =
      await this.pool.query<FieldDisclosureRow>(
        `
          INSERT INTO civic_registry_field_disclosures (
            registry_id,
            record_id,
            field_id,
            disposition,
            replacement_text,
            reason,
            authority,
            public_note,
            updated_at,
            actor_id
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8, $9::timestamptz, $10
          )
          ON CONFLICT (
            registry_id,
            record_id,
            field_id
          )
          DO UPDATE SET
            disposition = EXCLUDED.disposition,
            replacement_text =
              EXCLUDED.replacement_text,
            reason = EXCLUDED.reason,
            authority = EXCLUDED.authority,
            public_note = EXCLUDED.public_note,
            updated_at = EXCLUDED.updated_at,
            actor_id = EXCLUDED.actor_id
          RETURNING *
        `,
        [
          disclosure.registryId,
          disclosure.recordId,
          disclosure.fieldId,
          disclosure.disposition,
          disclosure.replacementText ?? null,
          disclosure.reason ?? null,
          disclosure.authority ?? null,
          disclosure.publicNote ?? null,
          disclosure.updatedAt,
          disclosure.actorId ?? null,
        ],
      );

    return mapFieldDisclosure(result.rows[0]);
  }

  async clearFieldDisclosure(
    registryId: string,
    recordId: string,
    fieldId: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `
        DELETE FROM civic_registry_field_disclosures
        WHERE registry_id = $1
          AND record_id = $2
          AND field_id = $3
      `,
      [registryId, recordId, fieldId],
    );

    return (result.rowCount ?? 0) > 0;
  }

  async getDocumentDisclosure(
    registryId: string,
    documentId: string,
  ): Promise<DocumentDisclosure | null> {
    const result =
      await this.pool.query<DocumentDisclosureRow>(
        `
          SELECT *
          FROM civic_registry_document_disclosures
          WHERE registry_id = $1
            AND document_id = $2
        `,
        [registryId, documentId],
      );

    return result.rows[0]
      ? mapDocumentDisclosure(result.rows[0])
      : null;
  }

  async listDocumentRedactions(
    registryId: string,
    documentId: string,
  ): Promise<DocumentRedaction[]> {
    const result =
      await this.pool.query<DocumentRedactionRow>(
        `
          SELECT *
          FROM civic_registry_document_redactions
          WHERE registry_id = $1
            AND document_id = $2
          ORDER BY created_at, id
        `,
        [registryId, documentId],
      );

    return result.rows.map(mapDocumentRedaction);
  }

  async getDocumentBundle(
    registryId: string,
    documentId: string,
  ): Promise<DocumentDisclosureBundle> {
    const [document, redactions] =
      await Promise.all([
        this.getDocumentDisclosure(
          registryId,
          documentId,
        ),
        this.listDocumentRedactions(
          registryId,
          documentId,
        ),
      ]);

    return {
      document: document ?? undefined,
      redactions,
    };
  }

  async setDocumentDisclosure(
    disclosure: DocumentDisclosure,
  ): Promise<DocumentDisclosure> {
    await this.requireDocument(
      disclosure.registryId,
      disclosure.documentId,
    );
    requireDateTime(
      disclosure.updatedAt,
      "updatedAt",
    );
    optionalHttpUrl(
      disclosure.publicCanonicalUrl,
      "publicCanonicalUrl",
    );
    optionalNonEmpty(
      disclosure.publicStorageKey,
      "publicStorageKey",
    );
    optionalNonEmpty(
      disclosure.reason,
      "reason",
    );
    optionalNonEmpty(
      disclosure.authority,
      "authority",
    );
    optionalNonEmpty(
      disclosure.publicNote,
      "publicNote",
    );

    const result =
      await this.pool.query<DocumentDisclosureRow>(
        `
          INSERT INTO civic_registry_document_disclosures (
            registry_id,
            document_id,
            disposition,
            public_canonical_url,
            public_storage_key,
            reason,
            authority,
            public_note,
            updated_at,
            actor_id
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8, $9::timestamptz, $10
          )
          ON CONFLICT (registry_id, document_id)
          DO UPDATE SET
            disposition = EXCLUDED.disposition,
            public_canonical_url =
              EXCLUDED.public_canonical_url,
            public_storage_key =
              EXCLUDED.public_storage_key,
            reason = EXCLUDED.reason,
            authority = EXCLUDED.authority,
            public_note = EXCLUDED.public_note,
            updated_at = EXCLUDED.updated_at,
            actor_id = EXCLUDED.actor_id
          RETURNING *
        `,
        [
          disclosure.registryId,
          disclosure.documentId,
          disclosure.disposition,
          disclosure.publicCanonicalUrl ?? null,
          disclosure.publicStorageKey ?? null,
          disclosure.reason ?? null,
          disclosure.authority ?? null,
          disclosure.publicNote ?? null,
          disclosure.updatedAt,
          disclosure.actorId ?? null,
        ],
      );

    return mapDocumentDisclosure(result.rows[0]);
  }

  async clearDocumentDisclosure(
    registryId: string,
    documentId: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `
        DELETE FROM civic_registry_document_disclosures
        WHERE registry_id = $1
          AND document_id = $2
      `,
      [registryId, documentId],
    );

    return (result.rowCount ?? 0) > 0;
  }

  async upsertDocumentRedaction(
    redaction: DocumentRedaction,
  ): Promise<DocumentRedaction> {
    await this.requireDocument(
      redaction.registryId,
      redaction.documentId,
    );
    requireDateTime(
      redaction.createdAt,
      "createdAt",
    );
    optionalNonEmpty(
      redaction.replacementText,
      "replacementText",
    );
    optionalNonEmpty(
      redaction.reason,
      "reason",
    );
    optionalNonEmpty(
      redaction.authority,
      "authority",
    );
    optionalNonEmpty(
      redaction.publicNote,
      "publicNote",
    );

    const result =
      await this.pool.query<DocumentRedactionRow>(
        `
          INSERT INTO civic_registry_document_redactions (
            registry_id,
            id,
            document_id,
            locator,
            replacement_text,
            reason,
            authority,
            public_note,
            created_at,
            actor_id
          )
          VALUES (
            $1, $2, $3, $4::jsonb, $5,
            $6, $7, $8, $9::timestamptz, $10
          )
          ON CONFLICT (registry_id, id)
          DO UPDATE SET
            document_id = EXCLUDED.document_id,
            locator = EXCLUDED.locator,
            replacement_text =
              EXCLUDED.replacement_text,
            reason = EXCLUDED.reason,
            authority = EXCLUDED.authority,
            public_note = EXCLUDED.public_note,
            created_at = EXCLUDED.created_at,
            actor_id = EXCLUDED.actor_id
          RETURNING *
        `,
        [
          redaction.registryId,
          redaction.id,
          redaction.documentId,
          JSON.stringify(redaction.locator ?? {}),
          redaction.replacementText ?? null,
          redaction.reason ?? null,
          redaction.authority ?? null,
          redaction.publicNote ?? null,
          redaction.createdAt,
          redaction.actorId ?? null,
        ],
      );

    return mapDocumentRedaction(result.rows[0]);
  }

  async deleteDocumentRedaction(
    registryId: string,
    redactionId: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `
        DELETE FROM civic_registry_document_redactions
        WHERE registry_id = $1
          AND id = $2
      `,
      [registryId, redactionId],
    );

    return (result.rowCount ?? 0) > 0;
  }
}
