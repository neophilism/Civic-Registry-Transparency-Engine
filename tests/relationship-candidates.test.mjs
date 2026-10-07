import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  relationshipCandidateEvidenceHash,
} from "../packages/database/src/relationship-candidates.ts";
import {
  proposeOpenLegalInterpretationAuthorityCandidates,
} from "../examples/open-legal-interpretations/adapters/authority-extraction.ts";

test("relationship candidate evidence hashing is stable across object key order", () => {
  const left =
    relationshipCandidateEvidenceHash({
      source: "pdf",
      details: {
        page: 3,
        citation:
          "5 U.S.C. § 552",
      },
      tags: ["a", "b"],
    });
  const right =
    relationshipCandidateEvidenceHash({
      tags: ["a", "b"],
      details: {
        citation:
          "5 U.S.C. § 552",
        page: 3,
      },
      source: "pdf",
    });

  assert.equal(left, right);
});

test("legal authority extraction uses explicit citations and aliases without range inference", async () => {
  const proposals = [];
  const records = {
    async get() {
      return {
        id: "interpretation-1",
        registryId:
          "open-legal-interpretations",
        recordTypeId:
          "interpretation",
        fields: {
          title:
            "Example interpretation",
        },
        status: "published",
        visibility: "public",
        externalIdentifiers: [],
        tags: [],
        createdAt:
          "2026-10-07T12:00:00.000Z",
        updatedAt:
          "2026-10-07T12:00:00.000Z",
      };
    },
    async list() {
      return [
        {
          id: "authority-foia",
          fields: {
            citation:
              "5 U.S.C. § 552",
            authority_type:
              "statute",
          },
        },
        {
          id: "authority-apa",
          fields: {
            citation:
              "5 U.S.C. §§ 551–559",
            citation_aliases: [
              "5 U.S.C. § 551",
              "5 U.S.C. § 553",
            ],
            authority_type:
              "statute",
          },
        },
      ];
    },
  };
  const attachments = {
    async listExtractionsForRecord() {
      return [
        {
          citationId:
            "citation-1",
          documentId:
            "document-1",
          extraction: {
            pages: [
              {
                pageNumber: 1,
                text:
                  "Disclosure is governed by 5 U.S.C. § 552. " +
                  "Procedure is governed by 5 U.S.C. § 553.",
              },
              {
                pageNumber: 2,
                text:
                  "An unresolved example cites 5 U.S.C. § 999.",
              },
            ],
          },
        },
      ];
    },
  };
  const relationships = {
    async list() {
      return [];
    },
  };
  const candidates = {
    async propose(input) {
      proposals.push(input);
      return {
        kind: "candidate",
        candidate: input,
        created: true,
      };
    },
  };

  const result =
    await proposeOpenLegalInterpretationAuthorityCandidates({
      registryId:
        "open-legal-interpretations",
      recordId:
        "interpretation-1",
      attachments,
      records,
      relationships,
      candidates,
    });

  assert.equal(
    result.candidatesCreated,
    2,
  );
  assert.equal(
    result.unresolvedStructuredMentions,
    1,
  );

  const foia = proposals.find(
    (proposal) =>
      proposal.toRecordId ===
      "authority-foia",
  );
  const apa = proposals.find(
    (proposal) =>
      proposal.toRecordId ===
      "authority-apa",
  );

  assert.ok(foia);
  assert.ok(apa);

  assert.deepEqual(
    foia.evidence.mentions.map(
      (mention) =>
        mention.matchedText,
    ),
    ["5 U.S.C. § 552"],
  );
  assert.deepEqual(
    apa.evidence.mentions.map(
      (mention) =>
        mention.matchedText,
    ),
    ["5 U.S.C. § 553"],
  );
  assert.ok(
    apa.evidence.mentions.every(
      (mention) =>
        !mention.matchedText.includes(
          "552",
        ),
    ),
  );
});

test("legal authority extraction skips already-materialized relationships", async () => {
  const proposals = [];
  const result =
    await proposeOpenLegalInterpretationAuthorityCandidates({
      registryId:
        "open-legal-interpretations",
      recordId:
        "interpretation-1",
      attachments: {
        async listExtractionsForRecord() {
          return [
            {
              citationId:
                "citation-1",
              documentId:
                "document-1",
              extraction: {
                pages: [
                  {
                    pageNumber: 1,
                    text:
                      "See 5 U.S.C. § 552.",
                  },
                ],
              },
            },
          ];
        },
      },
      records: {
        async get() {
          return {
            id: "interpretation-1",
            recordTypeId:
              "interpretation",
            fields: {},
          };
        },
        async list() {
          return [
            {
              id: "authority-foia",
              fields: {
                citation:
                  "5 U.S.C. § 552",
              },
            },
          ];
        },
      },
      relationships: {
        async list() {
          return [
            {
              toRecordId:
                "authority-foia",
            },
          ];
        },
      },
      candidates: {
        async propose(input) {
          proposals.push(input);
          return {
            kind: "candidate",
            candidate: input,
            created: true,
          };
        },
      },
    });

  assert.equal(
    result.relationshipsAlreadyPresent,
    1,
  );
  assert.equal(
    result.candidatesCreated,
    0,
  );
  assert.equal(proposals.length, 0);
});


test("generic relationship-candidate engine remains domain neutral", () => {
  const service = fs.readFileSync(
    "packages/database/src/relationship-candidates.ts",
    "utf8",
  );
  const migration = fs.readFileSync(
    "packages/database/migrations/0013_relationship_candidates.sql",
    "utf8",
  );
  const admin = fs.readFileSync(
    "apps/web/app/admin/registries/[registryId]/relationship-candidates/page.tsx",
    "utf8",
  );
  const generic = [
    service,
    migration,
    admin,
  ].join("\n");

  assert.doesNotMatch(
    generic,
    /DOJ|OGE|OLC|legal_authority|Office of Legal Counsel|Government Ethics/i,
  );
  assert.match(
    service,
    /relationship_candidate\.proposed/,
  );
  assert.match(
    service,
    /pg_advisory_xact_lock/,
  );
  assert.match(
    admin,
    /Approve relationship/,
  );
});
