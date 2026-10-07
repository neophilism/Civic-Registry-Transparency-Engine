import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for database integration tests.");
}

const [configSource, seedSource] = await Promise.all([
  readFile("examples/generic-registry/registry.yaml", "utf8"),
  readFile("examples/generic-registry/seed.json", "utf8"),
]);
const config = parseRegistryConfig(configSource, {
  sourceName: "examples/generic-registry/registry.yaml",
});
const seed = JSON.parse(seedSource);

test("relationship candidates require review and materialize audited generic relationships", async () => {
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
    await seedRegistry(pool, config, seed);

    const configs = new PostgresRegistryConfigRepository(pool);
    const records = new PostgresRecordRepository(pool, configs);
    const relationships = new PostgresRelationshipRepository(
      pool,
      configs,
      records,
    );
    const candidates = new PostgresRelationshipCandidateService(
      pool,
    );

    await records.create(
      {
        id: "candidate-report",
        registryId: config.registry.id,
        recordTypeId: "document",
        fields: {
          title: "Candidate relationship report",
          summary: "Generic candidate test record.",
          document_type: "report",
          published_on: "2026-10-07",
        },
        status: "published",
        visibility: "public",
        externalIdentifiers: [],
        tags: ["test"],
        createdAt: "2026-10-07T14:00:00.000Z",
        updatedAt: "2026-10-07T14:00:00.000Z",
        publishedAt: "2026-10-07T14:00:00.000Z",
      },
      { bootstrapLifecycle: true },
    );

    const proposed = await candidates.propose({
      id: "candidate-published-by",
      registryId: config.registry.id,
      relationshipTypeId: "published-by",
      fromRecordId: "candidate-report",
      toRecordId: "example-agency",
      extractor: "integration-test-extractor",
      extractorVersion: "1.0.0",
      confidence: 0.99,
      evidence: {
        source: "synthetic-document",
        mentions: [
          {
            page: 1,
            matchedText: "Published by Example Public Agency",
          },
        ],
      },
      metadata: { test: true },
      proposedBy: "system:relationship-candidate-test",
      proposedAt: "2026-10-07T14:05:00.000Z",
    });

    assert.equal(proposed.kind, "candidate");
    assert.equal(proposed.created, true);
    assert.equal(proposed.candidate.status, "pending");

    await assert.rejects(
      pool.query(
        `
          UPDATE civic_registry_relationship_candidates
          SET status = 'rejected'
          WHERE registry_id = $1
            AND id = 'candidate-published-by'
        `,
        [config.registry.id],
      ),
      /must use the review service/i,
    );

    const approved = await candidates.review({
      registryId: config.registry.id,
      candidateId: "candidate-published-by",
      decision: "approved",
      actorId: "reviewer@example.org",
      note: "Verified against the cited source.",
      reviewedAt: "2026-10-07T14:10:00.000Z",
    });

    assert.equal(approved.candidate.status, "approved");
    assert.ok(approved.relationshipId);

    const materialized = await relationships.get(
      config.registry.id,
      approved.relationshipId,
    );
    assert.ok(materialized);
    assert.equal(
      materialized.relationshipTypeId,
      "published-by",
    );
    assert.equal(
      materialized.fromRecordId,
      "candidate-report",
    );
    assert.equal(
      materialized.toRecordId,
      "example-agency",
    );

    await assert.rejects(
      candidates.review({
        registryId: config.registry.id,
        candidateId: "candidate-published-by",
        decision: "approved",
        actorId: "second-reviewer@example.org",
      }),
      /Only pending relationship candidates/i,
    );

    const integrity = await new PostgresIntegrityService(
      pool,
    ).verifyRegistry(config.registry.id);
    assert.equal(integrity.valid, true);
  } finally {
    await pool.end();
  }
});
