import type {
  PostgresRecordRepository,
} from "@civic-registry/database";
import type {
  PostgresPdfAttachmentService,
} from "@civic-registry/database/attachments";
import type {
  SourceAdapterRow,
  SourceAdapterWarning,
} from "@civic-registry/source-adapters";

export interface LegalAttachmentProcessingResult {
  attachmentCreated: number;
  attachmentExisting: number;
  attachmentFailed: number;
  attachmentWarnings: number;
  fullTextUpdated: boolean;
  warnings: SourceAdapterWarning[];
}

export async function processOpenLegalInterpretationAttachments(
  input: {
    registryId: string;
    row: SourceAdapterRow;
    allowedHosts: readonly string[];
    attachments: PostgresPdfAttachmentService;
    records: PostgresRecordRepository;
  },
): Promise<LegalAttachmentProcessingResult> {
  const attachmentUrls =
    Array.isArray(
      input.row.attachment_urls,
    )
      ? input.row.attachment_urls
      : [];

  if (attachmentUrls.length === 0) {
    return {
      attachmentCreated: 0,
      attachmentExisting: 0,
      attachmentFailed: 0,
      attachmentWarnings: 0,
      fullTextUpdated: false,
      warnings: [],
    };
  }

  const result =
    await input.attachments.ingest({
      registryId:
        input.registryId,
      recordId: input.row.id,
      recordTitle:
        input.row.title,
      attachmentUrls,
      allowedHosts:
        input.allowedHosts,
      visibility: "public",
      fieldId: "full_text",
    });
  const warnings:
    SourceAdapterWarning[] = [];

  for (const item of result.items) {
    if (item.status === "failed") {
      warnings.push({
        code:
          "pdf_attachment_failed",
        message:
          item.error ??
          "PDF attachment ingestion failed.",
        url: item.url,
      });
    }

    for (const warning of
      item.warnings) {
      warnings.push({
        code:
          "pdf_attachment_warning",
        message: warning,
        url:
          item.finalUrl ??
          item.url,
      });
    }
  }

  let fullTextUpdated = false;

  if (result.extractedText) {
    const record =
      await input.records.get(
        input.registryId,
        input.row.id,
      );

    if (
      record &&
      record.fields.full_text !==
        result.extractedText
    ) {
      await input.records.update(
        {
          ...record,
          fields: {
            ...record.fields,
            full_text:
              result.extractedText,
          },
          updatedAt:
            new Date().toISOString(),
        },
        {
          context: {
            actorId:
              "system:source-refresh-worker",
            reason:
              "Refresh full text from retrieved PDF attachment.",
          },
        },
      );
      fullTextUpdated = true;
    }
  }

  return {
    attachmentCreated:
      result.created,
    attachmentExisting:
      result.existing,
    attachmentFailed:
      result.failed,
    attachmentWarnings:
      result.warnings,
    fullTextUpdated,
    warnings,
  };
}
