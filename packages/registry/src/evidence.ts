import type {
  CompiledRegistryConfig,
} from "@civic-registry/config";

import type {
  PublicDocumentDisclosure,
} from "./disclosure.ts";
import type {
  Citation,
  CitationLocator,
  Document,
  RegistryRecord,
  Source,
} from "@civic-registry/core";

export interface EvidenceCitationInput {
  citation: Citation;
  source?: Source;
  document?: Document;
  documentDisclosure?: PublicDocumentDisclosure;
}

export interface PresentedEvidenceSource {
  id: string;
  title: string;
  sourceType: Source["sourceType"];
  canonicalUrl?: string;
  publishedAt?: string;
  retrievedAt?: string;
  description?: string;
}

export interface PresentedEvidenceDocument {
  id: string;
  title: string;
  sourceId?: string;
  fileName?: string;
  mimeType?: string;
  canonicalUrl?: string;
  sha256?: string;
  pageCount?: number;
  language?: string;
  disclosure?: PublicDocumentDisclosure;
}

export interface PresentedCitation {
  id: string;
  fieldId?: string;
  scopeLabel: string;
  locatorLabel?: string;
  note?: string;
  createdAt: string;
  source?: PresentedEvidenceSource;
  document?: PresentedEvidenceDocument;
}

export interface PresentedCitationGroup {
  key: string;
  fieldId?: string;
  label: string;
  count: number;
  citations: PresentedCitation[];
}

function numberRange(
  singular: string,
  plural: string,
  start: number | undefined,
  end: number | undefined,
): string | undefined {
  if (start === undefined) return undefined;

  if (end !== undefined && end !== start) {
    return `${plural} ${start}–${end}`;
  }

  return `${singular} ${start}`;
}

export function formatCitationLocator(
  locator: CitationLocator | undefined,
): string | undefined {
  if (!locator) return undefined;

  const parts = [
    numberRange(
      "Page",
      "Pages",
      locator.page,
      locator.pageEnd,
    ),
    locator.section
      ? `Section ${locator.section}`
      : undefined,
    locator.paragraph
      ? `Paragraph ${locator.paragraph}`
      : undefined,
    numberRange(
      "Line",
      "Lines",
      locator.lineStart,
      locator.lineEnd,
    ),
    locator.fragment
      ? `Fragment: ${locator.fragment}`
      : undefined,
  ].filter(
    (part): part is string =>
      part !== undefined && part.length > 0,
  );

  return parts.length > 0
    ? parts.join(" · ")
    : undefined;
}

function citationScopeLabel(
  citation: Citation,
  record: RegistryRecord,
  registry: CompiledRegistryConfig,
): string {
  if (!citation.fieldId) return "Whole record";

  const recordType = registry.getRecordType(
    record.recordTypeId,
  );
  return (
    recordType.fieldsById.get(citation.fieldId)?.label ??
    citation.fieldId
  );
}

export function presentCitation(
  input: EvidenceCitationInput,
  record: RegistryRecord,
  registry: CompiledRegistryConfig,
): PresentedCitation {
  return {
    id: input.citation.id,
    fieldId: input.citation.fieldId,
    scopeLabel: citationScopeLabel(
      input.citation,
      record,
      registry,
    ),
    locatorLabel: formatCitationLocator(
      input.citation.locator,
    ),
    note: input.citation.note,
    createdAt: input.citation.createdAt,
    source: input.source
      ? {
          id: input.source.id,
          title: input.source.title,
          sourceType: input.source.sourceType,
          canonicalUrl: input.source.canonicalUrl,
          publishedAt: input.source.publishedAt,
          retrievedAt: input.source.retrievedAt,
          description: input.source.description,
        }
      : undefined,
    document: input.document
      ? {
          id: input.document.id,
          title: input.document.title,
          sourceId: input.document.sourceId,
          fileName: input.document.fileName,
          mimeType: input.document.mimeType,
          canonicalUrl: input.document.canonicalUrl,
          sha256: input.document.sha256,
          pageCount: input.document.pageCount,
          language: input.document.language,
          disclosure: input.documentDisclosure,
        }
      : undefined,
  };
}

export function groupPresentedCitations(
  citations: PresentedCitation[],
): PresentedCitationGroup[] {
  const groups = new Map<
    string,
    PresentedCitationGroup
  >();

  for (const citation of citations) {
    const key = citation.fieldId ?? "__record__";
    const existing = groups.get(key);

    if (existing) {
      existing.citations.push(citation);
      existing.count += 1;
      continue;
    }

    groups.set(key, {
      key,
      fieldId: citation.fieldId,
      label: citation.scopeLabel,
      count: 1,
      citations: [citation],
    });
  }

  return [...groups.values()].sort((left, right) => {
    if (!left.fieldId && right.fieldId) return -1;
    if (left.fieldId && !right.fieldId) return 1;
    return left.label.localeCompare(right.label);
  });
}
