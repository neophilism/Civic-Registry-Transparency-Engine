import {
  createHash,
} from "node:crypto";
import {
  basename,
} from "node:path";

import type {
  Citation,
  Document,
  Source,
  Visibility,
} from "@civic-registry/core";
import {
  extractPdfText,
  type DocumentStorage,
  type ExtractedDocumentPage,
  type PdfExtraction,
} from "@civic-registry/documents";
import {
  createPublicSourceClient,
  type PublicSourceClient,
} from "@civic-registry/source-adapters";
import type {
  Pool,
  QueryResultRow,
} from "pg";

import {
  PostgresCitationRepository,
  PostgresDocumentRepository,
  PostgresSourceRepository,
} from "./evidence.ts";
import {
  PostgresRecordRepository,
  PostgresRegistryConfigRepository,
} from "./repositories.ts";
import {
  PostgresDeadlineService,
} from "./deadlines.ts";

export interface DocumentExtraction {
  registryId: string;
  documentId: string;
  extractor: string;
  extractorVersion: string;
  text: string;
  textSha256: string;
  pages: ExtractedDocumentPage[];
  warnings: string[];
  extractedAt: string;
}

export interface PdfAttachmentIngestionInput {
  registryId: string;
  recordId: string;
  recordTitle: string;
  attachmentUrls: string[];
  allowedHosts: readonly string[];
  visibility?: Visibility;
  fieldId?: string;
  retrievedAt?: string;
}

export interface PdfAttachmentIngestionItem {
  url: string;
  finalUrl?: string;
  status:
    | "created"
    | "existing"
    | "failed";
  sourceId?: string;
  documentId?: string;
  citationId?: string;
  sha256?: string;
  storageKey?: string;
  pageCount?: number;
  text?: string;
  textSha256?: string;
  warnings: string[];
  error?: string;
}

export interface PdfAttachmentIngestionResult {
  items: PdfAttachmentIngestionItem[];
  created: number;
  existing: number;
  failed: number;
  warnings: number;
  extractedText: string;
}

interface ExtractionRow extends QueryResultRow {
  registry_id: string;
  document_id: string;
  extractor: string;
  extractor_version: string;
  text_content: string;
  text_sha256: string;
  pages: ExtractedDocumentPage[];
  warnings: string[];
  extracted_at: Date;
}

function mapExtraction(
  row: ExtractionRow,
): DocumentExtraction {
  return {
    registryId: row.registry_id,
    documentId: row.document_id,
    extractor: row.extractor,
    extractorVersion:
      row.extractor_version,
    text: row.text_content,
    textSha256: row.text_sha256,
    pages: row.pages ?? [],
    warnings: row.warnings ?? [],
    extractedAt:
      row.extracted_at.toISOString(),
  };
}

function hashBytes(
  data: Uint8Array,
): string {
  return createHash("sha256")
    .update(data)
    .digest("hex");
}

function hashText(
  value: string,
): string {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

function stableId(
  prefix: string,
  value: string,
  length = 24,
): string {
  return (
    prefix +
    "-" +
    hashText(value).slice(0, length)
  );
}

function fileNameFromUrl(
  value: string,
  fallbackHash: string,
): string {
  try {
    const url = new URL(value);
    const decoded =
      decodeURIComponent(
        basename(url.pathname),
      )
        .replace(/[\x00-\x1f\x7f]/g, "")
        .trim();

    if (
      decoded &&
      decoded !== "/" &&
      decoded.length <= 240
    ) {
      return decoded
        .toLowerCase()
        .endsWith(".pdf")
        ? decoded
        : decoded + ".pdf";
    }
  } catch {
    // Stable fallback below.
  }

  return (
    "document-" +
    fallbackHash.slice(0, 16) +
    ".pdf"
  );
}

function titleFromFileName(
  fileName: string,
  recordTitle: string,
): string {
  const stem =
    fileName
      .replace(/\.pdf$/i, "")
      .replace(/[-_]+/g, " ")
      .trim();

  return stem || recordTitle + " PDF";
}

export class PostgresPdfAttachmentService {
  private readonly pool: Pool;
  private readonly storage: DocumentStorage;
  private readonly client: PublicSourceClient;
  private readonly extractor: (
    data: Uint8Array,
  ) => Promise<PdfExtraction>;
  private readonly configs:
    PostgresRegistryConfigRepository;
  private readonly sources:
    PostgresSourceRepository;
  private readonly documents:
    PostgresDocumentRepository;
  private readonly citations:
    PostgresCitationRepository;

  constructor(
    pool: Pool,
    storage: DocumentStorage,
    options: {
      client?: PublicSourceClient;
      maxResponseBytes?: number;
      extractor?: (
        data: Uint8Array,
      ) => Promise<PdfExtraction>;
    } = {},
  ) {
    this.pool = pool;
    this.storage = storage;
    this.client =
      options.client ??
      createPublicSourceClient({
        maxResponseBytes:
          options.maxResponseBytes ??
          25 * 1024 * 1024,
        timeoutMs: 30_000,
      });
    this.extractor =
      options.extractor ??
      extractPdfText;
    this.configs =
      new PostgresRegistryConfigRepository(
        pool,
      );
    const deadlines =
      new PostgresDeadlineService(pool);
    const records =
      new PostgresRecordRepository(
        pool,
        this.configs,
        deadlines,
      );
    this.sources =
      new PostgresSourceRepository(
        pool,
        this.configs,
      );
    this.documents =
      new PostgresDocumentRepository(
        pool,
        this.configs,
        this.sources,
      );
    this.citations =
      new PostgresCitationRepository(
        pool,
        this.configs,
        records,
        this.sources,
        this.documents,
      );
  }

  async getExtraction(
    registryId: string,
    documentId: string,
    extractor = "pdfjs",
  ): Promise<DocumentExtraction | null> {
    const result =
      await this.pool.query<ExtractionRow>(
        `
          SELECT *
          FROM civic_registry_document_extractions
          WHERE registry_id = $1
            AND document_id = $2
            AND extractor = $3
        `,
        [
          registryId,
          documentId,
          extractor,
        ],
      );

    return result.rows[0]
      ? mapExtraction(result.rows[0])
      : null;
  }

  private async saveExtraction(
    registryId: string,
    documentId: string,
    extraction: PdfExtraction,
    extractedAt: string,
  ): Promise<DocumentExtraction> {
    const result =
      await this.pool.query<ExtractionRow>(
        `
          INSERT INTO civic_registry_document_extractions (
            registry_id,
            document_id,
            extractor,
            extractor_version,
            text_content,
            text_sha256,
            pages,
            warnings,
            extracted_at
          )
          VALUES (
            $1, $2, $3, $4, $5,
            $6, $7::jsonb, $8::jsonb,
            $9::timestamptz
          )
          ON CONFLICT (
            registry_id,
            document_id,
            extractor
          )
          DO UPDATE SET
            extractor_version =
              EXCLUDED.extractor_version,
            text_content =
              EXCLUDED.text_content,
            text_sha256 =
              EXCLUDED.text_sha256,
            pages =
              EXCLUDED.pages,
            warnings =
              EXCLUDED.warnings,
            extracted_at =
              EXCLUDED.extracted_at
          RETURNING *
        `,
        [
          registryId,
          documentId,
          extraction.extractor,
          extraction.extractorVersion,
          extraction.text,
          extraction.textSha256,
          JSON.stringify(
            extraction.pages,
          ),
          JSON.stringify(
            extraction.warnings,
          ),
          extractedAt,
        ],
      );

    return mapExtraction(
      result.rows[0],
    );
  }

  private async upsertSource(
    source: Source,
  ): Promise<{
    source: Source;
    existed: boolean;
  }> {
    const existing =
      await this.sources.get(
        source.registryId,
        source.id,
      );

    if (!existing) {
      return {
        source:
          await this.sources.create(
            source,
          ),
        existed: false,
      };
    }

    return {
      source:
        await this.sources.update({
          ...existing,
          title: source.title,
          visibility:
            source.visibility,
          canonicalUrl:
            source.canonicalUrl,
          retrievedAt:
            source.retrievedAt,
          description:
            source.description,
        }),
      existed: true,
    };
  }

  private async upsertDocument(
    document: Document,
  ): Promise<{
    document: Document;
    existed: boolean;
  }> {
    const existing =
      await this.documents.get(
        document.registryId,
        document.id,
      );

    if (!existing) {
      return {
        document:
          await this.documents.create(
            document,
          ),
        existed: false,
      };
    }

    return {
      document:
        await this.documents.update({
          ...existing,
          title: document.title,
          visibility:
            document.visibility,
          sourceId:
            document.sourceId,
          fileName:
            document.fileName,
          mimeType:
            document.mimeType,
          storageKey:
            document.storageKey,
          canonicalUrl:
            document.canonicalUrl,
          sha256: document.sha256,
          pageCount:
            document.pageCount,
        }),
      existed: true,
    };
  }

  private async upsertCitation(
    citation: Citation,
  ): Promise<{
    citation: Citation;
    existed: boolean;
  }> {
    const existing =
      await this.citations.get(
        citation.registryId,
        citation.id,
      );

    if (!existing) {
      return {
        citation:
          await this.citations.create(
            citation,
          ),
        existed: false,
      };
    }

    return {
      citation:
        await this.citations.update({
          ...existing,
          recordId:
            citation.recordId,
          fieldId:
            citation.fieldId,
          sourceId:
            citation.sourceId,
          documentId:
            citation.documentId,
          locator:
            citation.locator,
          note: citation.note,
          visibility:
            citation.visibility,
        }),
      existed: true,
    };
  }

  async ingest(
    input: PdfAttachmentIngestionInput,
  ): Promise<PdfAttachmentIngestionResult> {
    const visibility =
      input.visibility ?? "public";
    const retrievedAt =
      input.retrievedAt ??
      new Date().toISOString();
    const urls = [
      ...new Set(
        input.attachmentUrls
          .map((url) => url.trim())
          .filter(Boolean),
      ),
    ];
    const items:
      PdfAttachmentIngestionItem[] = [];

    for (const url of urls) {
      const item:
        PdfAttachmentIngestionItem = {
          url,
          status: "failed",
          warnings: [],
        };

      try {
        const fetched =
          await this.client.fetchBytes(
            url,
            input.allowedHosts,
          );
        const sha256 =
          hashBytes(fetched.body);
        const mimeType =
          fetched.contentType ||
          "application/pdf";

        if (
          fetched.contentType &&
          ![
            "application/pdf",
            "application/octet-stream",
            "binary/octet-stream",
          ].includes(
            fetched.contentType,
          )
        ) {
          item.warnings.push(
            "Attachment returned content type " +
              fetched.contentType +
              "; PDF signature validation was used instead.",
          );
        }

        const extraction =
          await this.extractor(
            fetched.body,
          );
        item.warnings.push(
          ...extraction.warnings,
        );
        const stored =
          await this.storage.put({
            sha256,
            extension: "pdf",
            data: fetched.body,
          });
        const sourceId =
          stableId(
            "attachment-source",
            fetched.finalUrl,
          );
        const documentId =
          stableId(
            "attachment-document",
            fetched.finalUrl,
            16,
          ) +
          "-" +
          sha256.slice(0, 16);
        const citationId =
          stableId(
            "attachment-citation",
            [
              input.recordId,
              documentId,
              input.fieldId ?? "",
            ].join("|"),
          );
        const fileName =
          fileNameFromUrl(
            fetched.finalUrl,
            sha256,
          );
        const sourceResult =
          await this.upsertSource({
            id: sourceId,
            registryId:
              input.registryId,
            title:
              titleFromFileName(
                fileName,
                input.recordTitle,
              ),
            sourceType: "document",
            visibility,
            canonicalUrl:
              fetched.finalUrl,
            retrievedAt:
              fetched.fetchedAt ||
              retrievedAt,
            description:
              "Retrieved PDF attachment for " +
              input.recordTitle +
              ".",
            createdAt: retrievedAt,
          });
        const documentResult =
          await this.upsertDocument({
            id: documentId,
            registryId:
              input.registryId,
            title:
              titleFromFileName(
                fileName,
                input.recordTitle,
              ),
            visibility,
            sourceId:
              sourceResult.source.id,
            fileName,
            mimeType:
              "application/pdf",
            storageKey:
              stored.storageKey,
            canonicalUrl:
              fetched.finalUrl,
            sha256,
            pageCount:
              extraction.pageCount,
            createdAt: retrievedAt,
          });
        await this.saveExtraction(
          input.registryId,
          documentId,
          extraction,
          retrievedAt,
        );
        const citationResult =
          await this.upsertCitation({
            id: citationId,
            registryId:
              input.registryId,
            recordId:
              input.recordId,
            fieldId:
              input.fieldId,
            sourceId:
              sourceResult.source.id,
            documentId:
              documentResult.document.id,
            locator: {
              page: 1,
              pageEnd:
                extraction.pageCount,
            },
            note:
              "Extracted from retrieved PDF attachment.",
            visibility,
            createdAt: retrievedAt,
          });

        item.status =
          sourceResult.existed &&
          documentResult.existed &&
          citationResult.existed
            ? "existing"
            : "created";
        item.finalUrl =
          fetched.finalUrl;
        item.sourceId = sourceId;
        item.documentId =
          documentId;
        item.citationId =
          citationId;
        item.sha256 = sha256;
        item.storageKey =
          stored.storageKey;
        item.pageCount =
          extraction.pageCount;
        item.text =
          extraction.text;
        item.textSha256 =
          extraction.textSha256;
      } catch (error) {
        item.error =
          error instanceof Error
            ? error.message
            : "Unknown PDF attachment ingestion error.";
      }

      items.push(item);
    }

    const extractedText =
      items
        .filter(
          (item) =>
            item.status !==
              "failed" &&
            item.text,
        )
        .map(
          (item) =>
            item.text as string,
        )
        .join("\n\n")
        .trim();

    return {
      items,
      created:
        items.filter(
          (item) =>
            item.status ===
            "created",
        ).length,
      existing:
        items.filter(
          (item) =>
            item.status ===
            "existing",
        ).length,
      failed:
        items.filter(
          (item) =>
            item.status ===
            "failed",
        ).length,
      warnings:
        items.reduce(
          (count, item) =>
            count +
            item.warnings.length,
          0,
        ),
      extractedText,
    };
  }
}
