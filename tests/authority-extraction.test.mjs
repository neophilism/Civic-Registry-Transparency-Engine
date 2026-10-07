import assert from "node:assert/strict";
import test from "node:test";

import {
  proposeOpenLegalInterpretationAuthorityCandidates,
} from "../examples/open-legal-interpretations/adapters/authority-extraction.ts";

function record(
  id,
  recordTypeId,
  fields,
) {
  return {
    id,
    registryId:
      "open-legal-interpretations",
    recordTypeId,
    fields,
    status: "published",
    visibility: "public",
    externalIdentifiers: [],
    tags: [],
    createdAt:
      "2026-10-07T12:00:00.000Z",
    updatedAt:
      "2026-10-07T12:00:00.000Z",
  };
}

test("legal authority extraction proposes only configured exact citations with page provenance", async () => {
  const interpretation = record(
    "interpretation-1",
    "interpretation",
    {
      title: "Example opinion",
    },
  );
  const foia = record(
    "authority-foia",
    "legal_authority",
    {
      citation: "5 U.S.C. § 552",
      name:
        "Freedom of Information Act",
      authority_type: "statute",
    },
  );
  const apa = record(
    "authority-apa",
    "legal_authority",
    {
      citation:
        "5 U.S.C. §§ 551–559",
      name:
        "Administrative Procedure Act",
      authority_type: "statute",
      citation_aliases: [
        "5 U.S.C. § 553",
      ],
    },
  );
  const stored =
    new Map();

  const result =
    await proposeOpenLegalInterpretationAuthorityCandidates(
      {
        registryId:
          "open-legal-interpretations",
        recordId:
          interpretation.id,
        records: {
          async get(
            registryId,
            recordId,
          ) {
            assert.equal(
              registryId,
              "open-legal-interpretations",
            );

            return recordId ===
              interpretation.id
              ? interpretation
              : null;
          },
          async list(
            registryId,
            options,
          ) {
            assert.equal(
              registryId,
              "open-legal-interpretations",
            );
            assert.equal(
              options.recordTypeId,
              "legal_authority",
            );
            return [foia, apa];
          },
        },
        attachments: {
          async listExtractionsForRecord(
            registryId,
            recordId,
          ) {
            assert.equal(
              registryId,
              "open-legal-interpretations",
            );
            assert.equal(
              recordId,
              interpretation.id,
            );

            return [
              {
                citationId:
                  "citation-1",
                fieldId: "full_text",
                documentId:
                  "document-1",
                extraction: {
                  registryId:
                    registryId,
                  documentId:
                    "document-1",
                  extractor: "pdfjs",
                  extractorVersion:
                    "6.4.299",
                  text:
                    "The opinion discusses 5 U.S.C. § 552. It also relies on 5 U.S.C. § 553. A separate reference to 18 U.S.C. § 1001 is not configured.",
                  textSha256:
                    "a".repeat(64),
                  pages: [
                    {
                      page: 2,
                      text:
                        "The opinion discusses 5 U.S.C. § 552. It also relies on 5 U.S.C. § 553. A separate reference to 18 U.S.C. § 1001 is not configured.",
                    },
                  ],
                  warnings: [],
                  extractedAt:
                    "2026-10-07T12:30:00.000Z",
                },
              },
            ];
          },
        },
        relationships: {
          async list() {
            return [];
          },
        },
        candidates: {
          async propose(input) {
            const existing =
              stored.get(input.id);

            if (existing) {
              return {
                kind: "candidate",
                candidate: existing,
                created: false,
              };
            }

            const candidate = {
              ...input,
              status: "pending",
              evidenceSha256:
                "b".repeat(64),
              metadata:
                input.metadata ?? {},
              proposedAt:
                input.proposedAt ??
                "2026-10-07T12:35:00.000Z",
            };
            stored.set(
              input.id,
              candidate,
            );

            return {
              kind: "candidate",
              candidate,
              created: true,
            };
          },
        },
      },
    );

  assert.equal(
    result.authoritiesConsidered,
    2,
  );
  assert.equal(
    result.documentsConsidered,
    1,
  );
  assert.equal(
    result.mentionsFound,
    2,
  );
  assert.equal(
    result.candidatesCreated,
    2,
  );
  assert.equal(
    result.unresolvedStructuredMentions,
    1,
  );
  assert.equal(stored.size, 2);

  const proposals =
    [...stored.values()];
  const foiaProposal =
    proposals.find(
      (candidate) =>
        candidate.toRecordId ===
        "authority-foia",
    );
  const apaProposal =
    proposals.find(
      (candidate) =>
        candidate.toRecordId ===
        "authority-apa",
    );

  assert.ok(foiaProposal);
  assert.ok(apaProposal);

  assert.deepEqual(
    foiaProposal.evidence.mentions.map(
      (mention) => ({
        documentId:
          mention.documentId,
        page: mention.page,
        matchedText:
          mention.matchedText,
        matchKind:
          mention.matchKind,
      }),
    ),
    [
      {
        documentId: "document-1",
        page: 2,
        matchedText:
          "5 U.S.C. § 552",
        matchKind:
          "configured_exact",
      },
    ],
  );
  assert.equal(
    apaProposal.evidence.mentions[0]
      .matchedAuthorityCitation,
    "5 U.S.C. § 553",
  );

  const repeated =
    await proposeOpenLegalInterpretationAuthorityCandidates(
      {
        registryId:
          "open-legal-interpretations",
        recordId:
          interpretation.id,
        records: {
          async get() {
            return interpretation;
          },
          async list() {
            return [foia, apa];
          },
        },
        attachments: {
          async listExtractionsForRecord() {
            return [
              {
                citationId:
                  "citation-1",
                fieldId: "full_text",
                documentId:
                  "document-1",
                extraction: {
                  registryId:
                    "open-legal-interpretations",
                  documentId:
                    "document-1",
                  extractor: "pdfjs",
                  extractorVersion:
                    "6.4.299",
                  text:
                    "5 U.S.C. § 552 and 5 U.S.C. § 553",
                  textSha256:
                    "a".repeat(64),
                  pages: [
                    {
                      page: 2,
                      text:
                        "5 U.S.C. § 552 and 5 U.S.C. § 553",
                    },
                  ],
                  warnings: [],
                  extractedAt:
                    "2026-10-07T12:30:00.000Z",
                },
              },
            ];
          },
        },
        relationships: {
          async list() {
            return [];
          },
        },
        candidates: {
          async propose(input) {
            return {
              kind: "candidate",
              candidate:
                stored.get(input.id),
              created: false,
            };
          },
        },
      },
    );

  assert.equal(
    repeated.candidatesCreated,
    0,
  );
  assert.equal(
    repeated.candidatesExisting,
    2,
  );
});

test("existing canonical relationship suppresses a duplicate authority candidate", async () => {
  const interpretation = record(
    "interpretation-2",
    "interpretation",
    { title: "Existing link" },
  );
  const authority = record(
    "authority-foia",
    "legal_authority",
    {
      citation: "5 U.S.C. § 552",
      authority_type: "statute",
    },
  );
  let proposeCalls = 0;

  const result =
    await proposeOpenLegalInterpretationAuthorityCandidates(
      {
        registryId:
          "open-legal-interpretations",
        recordId:
          interpretation.id,
        records: {
          async get() {
            return interpretation;
          },
          async list() {
            return [authority];
          },
        },
        attachments: {
          async listExtractionsForRecord() {
            return [
              {
                citationId: "c1",
                documentId: "d1",
                extraction: {
                  registryId:
                    "open-legal-interpretations",
                  documentId: "d1",
                  extractor: "pdfjs",
                  extractorVersion:
                    "6.4.299",
                  text:
                    "5 U.S.C. § 552",
                  textSha256:
                    "c".repeat(64),
                  pages: [
                    {
                      page: 1,
                      text:
                        "5 U.S.C. § 552",
                    },
                  ],
                  warnings: [],
                  extractedAt:
                    "2026-10-07T12:30:00.000Z",
                },
              },
            ];
          },
        },
        relationships: {
          async list() {
            return [
              {
                id: "relationship-1",
                registryId:
                  "open-legal-interpretations",
                relationshipTypeId:
                  "interprets-authority",
                fromRecordId:
                  interpretation.id,
                toRecordId:
                  authority.id,
                createdAt:
                  "2026-10-07T12:00:00.000Z",
                metadata: {},
              },
            ];
          },
        },
        candidates: {
          async propose() {
            proposeCalls += 1;
            throw new Error(
              "Should not propose duplicate relationship.",
            );
          },
        },
      },
    );

  assert.equal(proposeCalls, 0);
  assert.equal(
    result.relationshipsAlreadyPresent,
    1,
  );
  assert.equal(
    result.candidatesCreated,
    0,
  );
});
