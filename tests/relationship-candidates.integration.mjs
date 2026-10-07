import assert from "node:assert/strict";
import {
  readFile,
} from "node:fs/promises";
import test from "node:test";

import {
  parseRegistryConfig,
} from "../packages/config/src/index.ts";
import {
  createDatabasePool,
  PostgresIntegrityService,
  PostgresRecordRepository,
  PostgresRegistryConfigRepository,
  PostgresRelationshipCandidateService,
  PostgresRelationshipRepository,
  runMigrations,
  seedRegistry,
} from "../packages/database/src/index.ts";

const databaseUrl =
  process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required for database integration tests.",
  );
}

const [
  configSource,
  seedSource,
] = await Promise.all([
  readFile(
    "examples/open-legal-interpretations/registry.yaml",
    "utf8",
  ),
  readFile(
    "examples/open-legal-interpretations/seed.json",
    "utf8",
  ),
]);

const config = parseRegistryConfig(
  configSource,
  {
    sourceName:
      "examples/open-legal-interpretations/registry.yaml",
  },
);
const seed = JSON.parse(seedSource);

function authorityRecord(
  id,
  citation,
  name,
  now,
) {
  return {
    id,
    registryId:
      config.registry.id,
    recordTypeId:
      "legal_authority",
    fields: {
      citation,
      name,
      authority_type:
        "statute",
    },
    status: "published",
    visibility: "public",
    externalIdentifiers: [],
    tags: ["test-authority"],
    createdAt: now,
    updatedAt: now,
    publishedAt: now,
  };
}

function proposal(
  id,
  toRecordId,
  citation,
) {
  return {
    id,
    registryId:
      config.registry.id,
    relationshipTypeId:
      "interprets-authority",
    fromRecordId:
      "demo-interpretation-2026-02",
    toRecordId,
    extractor:
      "integration-test-extractor",
    extractorVersion: "1.0.0",
    confidence: 0.99,
    evidence: {
      source:
        "pdf_document_extraction",
      authorityCitation:
        citation,
      mentions: [
        {
          documentId:
            "document-test-1",
          page: 2,
          matchedText: citation,
          excerpt:
            "Synthetic primary-source excerpt containing " +
            citation +
            ".",
        },
      ],
    },
    metadata: {
      test: true,
    },
    proposedBy:
      "system:relationship-candidate-test",
    proposedAt:
      "2026-10-07T14:00:00.000Z",
  };
}

test("relationship candidates require review, preserve evidence provenance, and materialize audited relationships", async () => {
  const pool = createDatabasePool({
    connectionString: databaseUrl,
    applicationName:
      "civic-registry-relationship-candidate-tests",
  });

  try {
    await runMigrations(pool);
    await pool.query(
      "TRUNCATE civic_registry_configurations CASCADE",
    );
    await seedRegistry(
      pool,
      config,
      seed,
    );

    const configs =
      new PostgresRegistryConfigRepository(
        pool,
      );
    const records =
      new PostgresRecordRepository(
        pool,
        configs,
      );
    const relationships =
      new PostgresRelationshipRepository(
        pool,
        configs,
        records,
      );
    const candidates =
      new PostgresRelationshipCandidateService(
        pool,
      );
    const now =
      "2026-10-07T13:00:00.000Z";

    await records.create(
      authorityRecord(
        "authority-review-approved",
        "42 U.S.C. § 1001",
        "Approved test authority",
        now,
      ),
      {
        bootstrapLifecycle: true,
      },
    );
    await records.create(
      authorityRecord(
        "authority-review-rejected",
        "42 U.S.C. § 1002",
        "Rejected test authority",
        now,
      ),
      {
        bootstrapLifecycle: true,
      },
    );
    await records.create(
      authorityRecord(
        "authority-review-tampered",
        "42 U.S.C. § 1003",
        "Tampered test authority",
        now,
      ),
      {
        bootstrapLifecycle: true,
      },
    );

    const proposed =
      await candidates.propose(
        proposal(
          "candidate-approved",
          "authority-review-approved",
          "42 U.S.C. § 1001",
        ),
      );

    assert.equal(
      proposed.kind,
      "candidate",
    );
    assert.equal(
      proposed.created,
      true,
    );
    assert.equal(
      proposed.candidate.status,
      "pending",
    );

    const proposalAudit =
      await pool.query(
        `
          SELECT metadata
          FROM civic_registry_audit_events
          WHERE registry_id = $1
            AND event_type =
              'relationship_candidate.proposed'
            AND metadata ->> 'candidateId' =
              'candidate-approved'
        `,
        [config.registry.id],
      );

    assert.equal(
      proposalAudit.rowCount,
      1,
    );
    assert.equal(
      proposalAudit.rows[0]
        .metadata.evidenceSha256,
      proposed.candidate
        .evidenceSha256,
    );

    await assert.rejects(
      pool.query(
        `
          UPDATE civic_registry_relationship_candidates
          SET
            status = 'rejected',
            reviewed_at = NOW(),
            reviewed_by = 'bypass'
          WHERE registry_id = $1
            AND id = 'candidate-approved'
        `,
        [config.registry.id],
      ),
      /must use the review service/i,
    );

    await assert.rejects(
      pool.query(
        `
          UPDATE civic_registry_relationship_candidates
          SET evidence =
            '{"tampered": true}'::jsonb
          WHERE registry_id = $1
            AND id = 'candidate-approved'
        `,
        [config.registry.id],
      ),
      /proposal evidence is immutable/i,
    );

    const approved =
      await candidates.review({
        registryId:
          config.registry.id,
        candidateId:
          "candidate-approved",
        decision: "approved",
        actorId:
          "reviewer@example.org",
        note:
          "Verified against the cited page.",
        reason:
          "Approve verified legal-authority relationship.",
        reviewedAt:
          "2026-10-07T14:10:00.000Z",
      });

    assert.equal(
      approved.candidate.status,
      "approved",
    );
    assert.ok(
      approved.relationshipId,
    );
    assert.equal(
      approved.candidate
        .relationshipId,
      approved.relationshipId,
    );

    const materialized =
      await relationships.get(
        config.registry.id,
        approved.relationshipId,
      );

    assert.ok(materialized);
    assert.equal(
      materialized.relationshipTypeId,
      "interprets-authority",
    );
    assert.equal(
      materialized.fromRecordId,
      "demo-interpretation-2026-02",
    );
    assert.equal(
      materialized.toRecordId,
      "authority-review-approved",
    );
    assert.equal(
      materialized.metadata
        .reviewedCandidateId,
      "candidate-approved",
    );

    const approvalEvents =
      await pool.query(
        `
          SELECT event_type, actor_id
          FROM civic_registry_audit_events
          WHERE registry_id = $1
            AND subject_id =
              'demo-interpretation-2026-02'
            AND (
              event_type =
                'relationship_candidate.approved'
              OR (
                event_type =
                  'relationship.added'
                AND metadata ->> 'relationshipId' = $2
              )
            )
          ORDER BY id
        `,
        [
          config.registry.id,
          approved.relationshipId,
        ],
      );

    assert.ok(
      approvalEvents.rows.some(
        (event) =>
          event.event_type ===
            "relationship_candidate.approved" &&
          event.actor_id ===
            "reviewer@example.org",
      ),
    );
    assert.ok(
      approvalEvents.rows.some(
        (event) =>
          event.event_type ===
            "relationship.added" &&
          event.actor_id ===
            "reviewer@example.org",
      ),
    );

    await assert.rejects(
      candidates.review({
        registryId:
          config.registry.id,
        candidateId:
          "candidate-approved",
        decision: "approved",
        actorId:
          "second-reviewer@example.org",
      }),
      /Only pending relationship candidates/i,
    );

    const rejectedProposal =
      await candidates.propose(
        proposal(
          "candidate-rejected",
          "authority-review-rejected",
          "42 U.S.C. § 1002",
        ),
      );

    assert.equal(
      rejectedProposal.kind,
      "candidate",
    );

    const rejected =
      await candidates.review({
        registryId:
          config.registry.id,
        candidateId:
          "candidate-rejected",
        decision: "rejected",
        actorId:
          "reviewer@example.org",
        note:
          "Citation context does not support the proposed relationship.",
        reviewedAt:
          "2026-10-07T14:20:00.000Z",
      });

    assert.equal(
      rejected.candidate.status,
      "rejected",
    );
    assert.equal(
      rejected.relationshipId,
      undefined,
    );
    assert.equal(
      (
        await relationships.list(
          config.registry.id,
          {
            relationshipTypeId:
              "interprets-authority",
            recordId:
              "authority-review-rejected",
            direction: "to",
          },
        )
      ).length,
      0,
    );

    await assert.rejects(
      pool.query(
        `
          DELETE FROM civic_registry_relationship_candidates
          WHERE registry_id = $1
            AND id = 'candidate-rejected'
        `,
        [config.registry.id],
      ),
      /review history is immutable/i,
    );

    const tamperedProposal =
      await candidates.propose(
        proposal(
          "candidate-tampered",
          "authority-review-tampered",
          "42 U.S.C. § 1003",
        ),
      );

    assert.equal(
      tamperedProposal.kind,
      "candidate",
    );

    await pool.query(
      `
        ALTER TABLE civic_registry_relationship_candidates
        DISABLE TRIGGER
          civic_registry_relationship_candidates_proposal_immutable
      `,
    );
    await pool.query(
      `
        UPDATE civic_registry_relationship_candidates
        SET evidence =
          '{"tampered": true}'::jsonb
        WHERE registry_id = $1
          AND id = 'candidate-tampered'
      `,
      [config.registry.id],
    );
    await pool.query(
      `
        ALTER TABLE civic_registry_relationship_candidates
        ENABLE TRIGGER
          civic_registry_relationship_candidates_proposal_immutable
      `,
    );

    await assert.rejects(
      candidates.review({
        registryId:
          config.registry.id,
        candidateId:
          "candidate-tampered",
        decision: "approved",
        actorId:
          "reviewer@example.org",
      }),
      /evidence does not match its stored SHA-256|immutable proposal audit event/i,
    );

    const integrity =
      await new PostgresIntegrityService(
        pool,
      ).verifyRegistry(
        config.registry.id,
      );

    assert.equal(
      integrity.valid,
      true,
    );
  } finally {
    await pool.end();
  }
});
