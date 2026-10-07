import assert from "node:assert/strict";
import {
  readFile,
} from "node:fs/promises";
import test from "node:test";

import {
  compileRegistryConfig,
  parseRegistryConfig,
} from "../packages/config/src/index.ts";
import {
  createDatabasePool,
  PostgresCitationRepository,
  PostgresDeadlineService,
  PostgresDocumentRepository,
  PostgresIntegrityService,
  PostgresRecordRepository,
  PostgresRegistryConfigRepository,
  PostgresRelationshipGraphRepository,
  PostgresSearchProvider,
  PostgresSourceRepository,
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
    "examples/smart-cities-surveillance-registry/registry.yaml",
    "utf8",
  ),
  readFile(
    "examples/smart-cities-surveillance-registry/seed.json",
    "utf8",
  ),
]);

const config = parseRegistryConfig(
  configSource,
  {
    sourceName:
      "examples/smart-cities-surveillance-registry/registry.yaml",
  },
);
const seed = JSON.parse(seedSource);

test("Smart Cities Surveillance Registry runs end-to-end on the generic engine", async () => {
  const pool = createDatabasePool({
    connectionString: databaseUrl,
    applicationName:
      "smart-cities-surveillance-registry-tests",
  });

  try {
    await runMigrations(pool);
    await pool.query(
      "TRUNCATE civic_registry_configurations CASCADE",
    );

    const seeded =
      await seedRegistry(
        pool,
        config,
        seed,
      );

    assert.deepEqual(
      {
        registryId:
          seeded.registryId,
        sourcesCreated:
          seeded.sourcesCreated,
        documentsCreated:
          seeded.documentsCreated,
        recordsCreated:
          seeded.recordsCreated,
        citationsCreated:
          seeded.citationsCreated,
        relationshipsCreated:
          seeded.relationshipsCreated,
      },
      {
        registryId:
          "smart-cities-surveillance-registry",
        sourcesCreated: 1,
        documentsCreated: 4,
        recordsCreated: 12,
        citationsCreated: 4,
        relationshipsCreated: 11,
      },
    );

    const compiled =
      compileRegistryConfig(config);
    const lifecycle =
      compiled.publicationLifecycle;

    assert.ok(lifecycle);

    const publicStatuses = [
      ...lifecycle.publicStatusIds,
    ];
    const search =
      new PostgresSearchProvider(pool);

    const result =
      await search.search(
        compiled,
        {
          registryId:
            config.registry.id,
          projection: "public",
          text:
            "retention deletion",
          statuses:
            publicStatuses,
          visibility: "public",
          pageSize: 50,
        },
      );

    assert.ok(
      result.hits.some(
        (hit) =>
          hit.record.id ===
          "policy-alpr-retention-2026",
      ),
    );
    assert.ok(
      result.hits.some(
        (hit) =>
          hit.record.id ===
          "violation-alpr-retention-2026",
      ),
    );

    const graph =
      await new PostgresRelationshipGraphRepository(
        pool,
      ).getGraph({
        registryId:
          config.registry.id,
        rootRecordId:
          "deployment-municipal-alpr-pilot",
        depth: 1,
        visibility: "public",
        statusIds:
          publicStatuses,
        maxNodes: 50,
      });

    assert.ok(graph);

    const edgeTypes =
      new Set(
        graph.edges.map(
          (edge) =>
            edge.relationshipTypeId,
        ),
      );

    for (const expected of [
      "uses-technology",
      "operated-by",
      "governed-by",
      "audits-deployment",
      "concerns-deployment",
    ]) {
      assert.ok(
        edgeTypes.has(expected),
        "Expected graph edge type " +
          expected,
      );
    }

    const deadlines =
      new PostgresDeadlineService(
        pool,
      );

    const deploymentDeadlines =
      await deadlines.listForRecord(
        config.registry.id,
        "deployment-municipal-alpr-pilot",
      );
    const policyDeadlines =
      await deadlines.listForRecord(
        config.registry.id,
        "policy-alpr-retention-2026",
      );
    const violationDeadlines =
      await deadlines.listForRecord(
        config.registry.id,
        "violation-alpr-retention-2026",
      );

    assert.equal(
      deploymentDeadlines[0]
        ?.deadlineTypeId,
      "deployment_audit_due",
    );
    assert.equal(
      deploymentDeadlines[0]
        ?.dueAt.slice(0, 10),
      "2027-04-01",
    );
    assert.equal(
      policyDeadlines[0]
        ?.deadlineTypeId,
      "policy_review_due",
    );
    assert.equal(
      policyDeadlines[0]
        ?.dueAt.slice(0, 10),
      "2027-03-01",
    );
    assert.equal(
      violationDeadlines[0]
        ?.deadlineTypeId,
      "violation_remediation_due",
    );
    assert.equal(
      violationDeadlines[0]
        ?.dueAt.slice(0, 10),
      "2026-11-15",
    );

    const configs =
      new PostgresRegistryConfigRepository(
        pool,
      );
    const records =
      new PostgresRecordRepository(
        pool,
        configs,
        deadlines,
      );
    const sources =
      new PostgresSourceRepository(
        pool,
        configs,
      );
    const documents =
      new PostgresDocumentRepository(
        pool,
        configs,
        sources,
      );
    const citations =
      new PostgresCitationRepository(
        pool,
        configs,
        records,
        sources,
        documents,
      );

    const evidence =
      await citations.listEvidenceForRecord(
        config.registry.id,
        "audit-alpr-2026",
        {
          visibility: "public",
        },
      );

    assert.equal(
      evidence.length,
      1,
    );
    assert.equal(
      evidence[0]?.document?.mimeType,
      "application/pdf",
    );
    assert.equal(
      evidence[0]?.citation.locator
        .page,
      4,
    );

    const complianceRecord =
      await records.get(
        config.registry.id,
        "deployment-municipal-alpr-pilot",
      );

    assert.equal(
      complianceRecord?.fields
        .compliance_external_ref,
      "registry:smart-cities-surveillance-registry:deployment-municipal-alpr-pilot",
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
      JSON.stringify(
        integrity.issues,
        null,
        2,
      ),
    );
    assert.equal(
      integrity.sourceCount,
      integrity.entryCount,
    );
  } finally {
    await pool.end();
  }
});
