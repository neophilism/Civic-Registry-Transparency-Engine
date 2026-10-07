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

interface AuthorityDescriptor {
  id: string;
  citation: string;
  authorityType?: string;
  parsed?: ParsedCitation;
}

interface CitationMention {
  documentId: string;
  citationId: string;
  page: number;
  matchedText: string;
  excerpt: string;
  matchKind:
    | "exact"
    | "range_member";
  confidence: number;
}

interface ParsedCitation {
  system: "usc" | "cfr";
  title: number;
  start: number;
  end: number;
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

function parseSectionNumber(
  value: string,
): number | undefined {
  const match = value.match(/^\d+/);

  if (!match) return undefined;

  const parsed = Number(match[0]);

  return Number.isFinite(parsed)
    ? parsed
    : undefined;
}

function parseKnownCitation(
  citation: string,
): ParsedCitation | undefined {
  const normalized = citation
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const match = normalized.match(
    /^(\d+)\s+(U\.?\s*S\.?\s*C\.?|C\.?\s*F\.?\s*R\.?)\s+§{1,2}\s*(\d+[A-Za-z0-9().-]*)(?:\s*-\s*(\d+[A-Za-z0-9().-]*))?$/i,
  );

  if (!match) return undefined;

  const start =
    parseSectionNumber(match[3]);
  const end =
    parseSectionNumber(
      match[4] ?? match[3],
    );

  if (
    start === undefined ||
    end === undefined
  ) {
    return undefined;
  }

  return {
    system:
      /^U/i.test(match[2])
        ? "usc"
        : "cfr",
    title: Number(match[1]),
    start: Math.min(start, end),
    end: Math.max(start, end),
  };
}

function structuredCitationRegex(
  system: "usc" | "cfr",
): RegExp {
  const middle =
    system === "usc"
      ? "U\\.?\\s*S\\.?\\s*C\\.?"
      : "C\\.?\\s*F\\.?\\s*R\\.?";

  return new RegExp(
    "\\b(\\d+)\\s+" +
      middle +
      "\\s+§{1,2}\\s*" +
      "(\\d+[A-Za-z0-9().-]*)" +
      "(?:\\s*[-–—]\\s*" +
      "(\\d+[A-Za-z0-9().-]*))?",
    "gi",
  );
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

function collectStructuredMentions(
  extraction: RecordDocumentExtraction,
  authorities: AuthorityDescriptor[],
  mentions:
    Map<string, CitationMention[]>,
  recognizedMentions: Set<string>,
): number {
  let structuredTotal = 0;

  for (const page of
    extraction.extraction.pages) {
    for (const system of [
      "usc",
      "cfr",
    ] as const) {
      const regex =
        structuredCitationRegex(
          system,
        );

      for (
        let match =
          regex.exec(page.text);
        match;
        match =
          regex.exec(page.text)
      ) {
        structuredTotal += 1;
        const title =
          Number(match[1]);
        const start =
          parseSectionNumber(
            match[2],
          );
        const end =
          parseSectionNumber(
            match[3] ?? match[2],
          );

        if (
          start === undefined ||
          end === undefined
        ) {
          continue;
        }

        const low =
          Math.min(start, end);
        const high =
          Math.max(start, end);
        const matched =
          match[0];
        let recognized = false;

        for (const authority of
          authorities) {
          const parsed =
            authority.parsed;

          if (
            !parsed ||
            parsed.system !==
              system ||
            parsed.title !== title
          ) {
            continue;
          }

          const exact =
            parsed.start === low &&
            parsed.end === high;
          const overlaps =
            high >= parsed.start &&
            low <= parsed.end;

          if (!overlaps) continue;

          recognized = true;
          const confidence =
            exact
              ? 0.995
              : 0.97;

          addMention(
            mentions,
            authority.id,
            {
              documentId:
                extraction.documentId,
              citationId:
                extraction.citationId,
              page: page.pageNumber,
              matchedText: matched,
              excerpt: excerptAround(
                page.text,
                match.index,
                matched.length,
              ),
              matchKind:
                exact
                  ? "exact"
                  : "range_member",
              confidence,
            },
          );
        }

        if (recognized) {
          recognizedMentions.add(
            [
              extraction.documentId,
              page.pageNumber,
              match.index,
              matched,
            ].join("|"),
          );
        }
      }
    }
  }

  return structuredTotal;
}

function collectExactMentions(
  extraction: RecordDocumentExtraction,
  authorities: AuthorityDescriptor[],
  mentions:
    Map<string, CitationMention[]>,
): void {
  for (const authority of
    authorities) {
    const regex =
      flexibleExactRegex(
        authority.citation,
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
              page.pageNumber,
            matchedText: matched,
            excerpt: excerptAround(
              page.text,
              match.index,
              matched.length,
            ),
            matchKind: "exact",
            confidence: 0.99,
          },
        );
      }
    }
  }
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

        return {
          id: authority.id,
          citation:
            citation.trim(),
          authorityType:
            typeof authority.fields
              .authority_type ===
            "string"
              ? authority.fields
                  .authority_type
              : undefined,
          parsed:
            parseKnownCitation(
              citation,
            ),
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
  const recognizedStructured =
    new Set<string>();
  let structuredTotal = 0;

  for (const extraction of
    extractions) {
    structuredTotal +=
      collectStructuredMentions(
        extraction,
        authorities,
        mentions,
        recognizedStructured,
      );
    collectExactMentions(
      extraction,
      authorities,
      mentions,
    );
  }

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

    const evidence = {
      source:
        "pdf_document_extraction",
      authorityCitation:
        authority.citation,
      authorityType:
        authority.authorityType ??
        null,
      mentions:
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
          .slice(0, 50),
    };
    const confidence =
      Math.max(
        ...authorityMentions.map(
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
              authorityMentions.length,
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
    unresolvedStructuredMentions:
      Math.max(
        0,
        structuredTotal -
          recognizedStructured.size,
      ),
  };
}

export const legalAuthorityExtractorInfo = {
  id: EXTRACTOR,
  version: EXTRACTOR_VERSION,
};
