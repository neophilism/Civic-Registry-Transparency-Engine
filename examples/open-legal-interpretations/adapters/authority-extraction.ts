import {
  createHash,
} from "node:crypto";

import type {
  PostgresRecordRepository,
  PostgresRelationshipCandidateService,
  PostgresRelationshipRepository,
} from "@civic-registry/database";
import type {
  PostgresPdfAttachmentService,
  RecordDocumentExtraction,
} from "@civic-registry/database/attachments";

const EXTRACTOR =
  "known-legal-authority-citation";
const EXTRACTOR_VERSION = "1.0.0";

interface AuthorityForm {
  citation: string;
}

interface AuthorityDescriptor {
  id: string;
  citation: string;
  authorityType: string | undefined;
  forms: AuthorityForm[];
}

interface CitationMention {
  documentId: string;
  citationId: string;
  page: number;
  matchedText: string;
  matchedAuthorityCitation: string;
  excerpt: string;
  matchKind: "configured_exact";
  confidence: number;
}

export interface LegalAuthorityExtractionResult {
  authoritiesConsidered: number;
  documentsConsidered: number;
  mentionsFound: number;
  candidatesCreated: number;
  candidatesExisting: number;
  relationshipsAlreadyPresent: number;
  unresolvedStructuredMentions: number;
}

function sha256(
  value: string,
): string {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

function structuredCitationRegex(): RegExp {
  return /\b\d+\s+(?:U\.?\s*S\.?\s*C\.?|C\.?\s*F\.?\s*R\.?)\s+§{1,2}\s*[0-9A-Za-z][0-9A-Za-z().-]*(?:\s*[-–—]\s*[0-9A-Za-z][0-9A-Za-z().-]*)?/gi;
}

function citationKey(
  value: string,
): string {
  return value
    .replace(/[.,;:]+$/g, "")
    .replace(/[–—]/g, "-")
    .replace(
      /U\.?\s*S\.?\s*C\.?/gi,
      "USC",
    )
    .replace(
      /C\.?\s*F\.?\s*R\.?/gi,
      "CFR",
    )
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function escapeRegex(
  value: string,
): string {
  return value.replace(
    /[.*+?^$()|[\]\\]/g,
    "\\$&",
  );
}

function flexibleExactRegex(
  citation: string,
): RegExp {
  const normalized = citation
    .trim()
    .replace(/[–—]/g, "-");
  let pattern =
    escapeRegex(normalized);

  pattern = pattern
    .replace(/\s+/g, "\\s+")
    .replace(
      /-/g,
      "[-–—]",
    )
    .replace(
      /\\\./g,
      "\\.?",
    );

  return new RegExp(
    pattern,
    "gi",
  );
}

function excerptAround(
  text: string,
  start: number,
  length: number,
  radius = 180,
): string {
  const from = Math.max(
    0,
    start - radius,
  );
  const to = Math.min(
    text.length,
    start + length + radius,
  );

  return text
    .slice(from, to)
    .replace(/\s+/g, " ")
    .trim();
}

function mentionKey(
  mention: CitationMention,
): string {
  return [
    mention.documentId,
    mention.page,
    mention.matchedText
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase(),
  ].join("|");
}

function addMention(
  map: Map<string, CitationMention[]>,
  authorityId: string,
  mention: CitationMention,
): void {
  const current =
    map.get(authorityId) ?? [];
  const key =
    mentionKey(mention);

  if (
    current.some(
      (item) =>
        mentionKey(item) === key,
    )
  ) {
    return;
  }

  current.push(mention);
  map.set(
    authorityId,
    current,
  );
}

function citationAliases(
  value: unknown,
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .filter(
          (entry): entry is string =>
            typeof entry === "string",
        )
        .map((entry) =>
          entry.trim(),
        )
        .filter(Boolean),
    ),
  ];
}

function sameParsedCitation(
  left: ParsedCitation,
  right: ParsedCitation,
): boolean {
  return (
    left.system === right.system &&
    left.title === right.title &&
    left.start === right.start &&
    left.end === right.end
  );
}

function collectConfiguredExactMentions(
  extraction: RecordDocumentExtraction,
  authorities: AuthorityDescriptor[],
  mentions:
    Map<string, CitationMention[]>,
): void {
  for (const authority of
    authorities) {
    for (const form of
      authority.forms) {
      const regex =
        flexibleExactRegex(
          form.citation,
        );

      for (const page of
        extraction.extraction.pages) {
        for (
          let match =
            regex.exec(page.text);
          match;
          match =
            regex.exec(page.text)
        ) {
          const matched =
            match[0];

          addMention(
            mentions,
            authority.id,
            {
              documentId:
                extraction.documentId,
              citationId:
                extraction.citationId,
              page:
                page.page,
              matchedText: matched,
              matchedAuthorityCitation:
                form.citation,
              excerpt:
                excerptAround(
                  page.text,
                  match.index,
                  matched.length,
                ),
              matchKind:
                "configured_exact",
              confidence: 0.99,
            },
          );
        }
      }
    }
  }
}

function countUnresolvedStructuredMentions(
  extractions: RecordDocumentExtraction[],
  configuredForms: Set<string>,
): number {
  let unresolved = 0;

  for (const extraction of extractions) {
    for (const page of extraction.extraction.pages) {
      const regex =
        structuredCitationRegex();

      for (
        let match = regex.exec(page.text);
        match;
        match = regex.exec(page.text)
      ) {
        const key =
          citationKey(match[0]);

        if (
          !configuredForms.has(key)
        ) {
          unresolved += 1;
        }
      }
    }
  }

  return unresolved;
}

function candidateId(
  recordId: string,
  authorityId: string,
  evidence: Record<string, unknown>,
): string {
  return (
    "authority-candidate-" +
    sha256(
      JSON.stringify({
        recordId,
        authorityId,
        extractor:
          EXTRACTOR,
        extractorVersion:
          EXTRACTOR_VERSION,
        evidence,
      }),
    ).slice(0, 32)
  );
}

export async function proposeOpenLegalInterpretationAuthorityCandidates(
  input: {
    registryId: string;
    recordId: string;
    attachments: PostgresPdfAttachmentService;
    records: PostgresRecordRepository;
    relationships: PostgresRelationshipRepository;
    candidates: PostgresRelationshipCandidateService;
  },
): Promise<LegalAuthorityExtractionResult> {
  const record =
    await input.records.get(
      input.registryId,
      input.recordId,
    );

  if (
    !record ||
    record.recordTypeId !==
      "interpretation"
  ) {
    return {
      authoritiesConsidered: 0,
      documentsConsidered: 0,
      mentionsFound: 0,
      candidatesCreated: 0,
      candidatesExisting: 0,
      relationshipsAlreadyPresent: 0,
      unresolvedStructuredMentions: 0,
    };
  }

  const [
    authorityRecords,
    extractions,
    existingRelationships,
  ] = await Promise.all([
    input.records.list(
      input.registryId,
      {
        recordTypeId:
          "legal_authority",
        limit: 500,
      },
    ),
    input.attachments.listExtractionsForRecord(
      input.registryId,
      input.recordId,
    ),
    input.relationships.list(
      input.registryId,
      {
        relationshipTypeId:
          "interprets-authority",
        recordId:
          input.recordId,
        direction: "from",
        limit: 500,
      },
    ),
  ]);

  const authorities:
    AuthorityDescriptor[] =
    authorityRecords
      .map((authority) => {
        const citation =
          authority.fields.citation;

        if (
          typeof citation !==
            "string" ||
          !citation.trim()
        ) {
          return undefined;
        }

        const canonical =
          citation.trim();
        const forms = [
          canonical,
          ...citationAliases(
            authority.fields
              .citation_aliases,
          ),
        ].map((form) => ({
          citation: form,
        }));

        return {
          id: authority.id,
          citation: canonical,
          authorityType:
            typeof authority.fields
              .authority_type ===
            "string"
              ? authority.fields
                  .authority_type
              : undefined,
          forms,
        };
      })
      .filter(
        (
          authority,
        ): authority is AuthorityDescriptor =>
          Boolean(authority),
      );
  const existingTargets =
    new Set(
      existingRelationships.map(
        (relationship) =>
          relationship.toRecordId,
      ),
    );
  const mentions =
    new Map<
      string,
      CitationMention[]
    >();
  const configuredForms =
    new Set(
      authorities.flatMap(
        (authority) =>
          authority.forms.map(
            (form) =>
              citationKey(
                form.citation,
              ),
          ),
      ),
    );

  for (const extraction of
    extractions) {
    collectConfiguredExactMentions(
      extraction,
      authorities,
      mentions,
    );
  }

  const unresolvedStructuredMentions =
    countUnresolvedStructuredMentions(
      extractions,
      configuredForms,
    );

  let candidatesCreated = 0;
  let candidatesExisting = 0;
  let relationshipsAlreadyPresent =
    0;

  for (const authority of
    authorities) {
    const authorityMentions =
      mentions.get(authority.id);

    if (
      !authorityMentions ||
      authorityMentions.length === 0
    ) {
      continue;
    }

    if (
      existingTargets.has(
        authority.id,
      )
    ) {
      relationshipsAlreadyPresent +=
        1;
      continue;
    }

    const sortedMentions =
      authorityMentions
        .sort(
          (left, right) =>
            left.documentId.localeCompare(
              right.documentId,
            ) ||
            left.page -
              right.page ||
            left.matchedText.localeCompare(
              right.matchedText,
            ),
        )
        .slice(0, 50);
    const evidence = {
      source:
        "pdf_document_extraction",
      authorityCitation:
        authority.citation,
      authorityType:
        authority.authorityType ??
        null,
      mentions:
        sortedMentions,
    };
    const confidence =
      Math.max(
        ...sortedMentions.map(
          (mention) =>
            mention.confidence,
        ),
      );
    const proposed =
      await input.candidates.propose(
        {
          id: candidateId(
            input.recordId,
            authority.id,
            evidence,
          ),
          registryId:
            input.registryId,
          relationshipTypeId:
            "interprets-authority",
          fromRecordId:
            input.recordId,
          toRecordId:
            authority.id,
          extractor: EXTRACTOR,
          extractorVersion:
            EXTRACTOR_VERSION,
          confidence,
          evidence,
          metadata: {
            authorityCitation:
              authority.citation,
            authorityType:
              authority.authorityType ??
              null,
            mentionCount:
              sortedMentions.length,
          },
          proposedBy:
            "system:legal-authority-extractor",
        },
      );

    if (
      proposed.kind ===
      "relationship_exists"
    ) {
      relationshipsAlreadyPresent +=
        1;
    } else if (
      proposed.created
    ) {
      candidatesCreated += 1;
    } else {
      candidatesExisting += 1;
    }
  }

  const mentionsFound =
    [...mentions.values()].reduce(
      (total, items) =>
        total + items.length,
      0,
    );

  return {
    authoritiesConsidered:
      authorities.length,
    documentsConsidered:
      extractions.length,
    mentionsFound,
    candidatesCreated,
    candidatesExisting,
    relationshipsAlreadyPresent,
    unresolvedStructuredMentions,
  };
}

export const legalAuthorityExtractorInfo = {
  id: EXTRACTOR,
  version: EXTRACTOR_VERSION,
};
