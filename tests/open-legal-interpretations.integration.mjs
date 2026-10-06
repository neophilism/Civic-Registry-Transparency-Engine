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
  parseIngestionProfile,
} from "../packages/ingestion/src/index.ts";
import {
  createDatabasePool,
  PostgresCitationRepository,
  PostgresDeadlineService,
  PostgresDocumentRepository,
  PostgresIngestionService,
  PostgresIntegrityService,
  PostgresRecordRepository,
  PostgresRegistryConfigRepository,
  PostgresRelationshipGraphRepository,
  PostgresSearchProvider,
  PostgresSourceRepository,
  runMigrations,
  seedRegistry,
} from "../packages/database/src/index.ts";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required for database integration tests.",
  );
}

const [
  configSource,
  seedSource,
  profileSource,
  importSource,
] = await Promise.all([
  readFile(
    "examples/open-legal-interpretations/registry.yaml",
    "utf8",
  ),
  readFile(
    "examples/open-legal-interpretations/seed.json",
    "utf8",
  ),
  readFile(
    "examples/open-legal-interpretations/import-profile.yaml",
    "utf8",
  ),
  readFile(
    "examples/open-legal-interpretations/import.csv",
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

test("Open Legal Interpretations runs end-to-end on the generic engine", async () => {
  const pool = createDatabasePool({
    connectionString: databaseUrl,
    applicationName:
      "open-legal-interpretations-integration-tests",
  });

  try {
    await runMigrations(pool);
    await pool.query(
      "TRUNCATE civic_registry_configurations CASCADE",
    );

    const seeded = await seedRegistry(
      pool,
      config,
      seed,
    );

    assert.deepEqual(
      {
        registryId: seeded.registryId,
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
          "open-legal-interpretations",
        sourcesCreated: 1,
        documentsCreated: 2,
        recordsCreated: 6,
        citationsCreated: 3,
        relationshipsCreated: 6,
      },
    );

    const compiled =
      compileRegistryConfig(config);
    const publicStatuses = [
      ...compiled.publicationLifecycle!
        .publicStatusIds,
    ];
    const search =
      new PostgresSearchProvider(pool);

    const result = await search.search(
      compiled,
      {
        registryId: config.registry.id,
        projection: "public",
        text:
          "publication procedural transparency",
        recordTypeId: "interpretation",
        statuses: publicStatuses,
        visibility: "public",
        pageSize: 20,
      },
    );

    assert.ok(
      result.hits.some(
        (hit) =>
          hit.record.id ===
          "demo-interpretation-2026-02",
      ),
    );

    const graph =
      await new PostgresRelationshipGraphRepository(
        pool,
      ).getGraph({
        registryId: config.registry.id,
        rootRecordId:
          "demo-interpretation-2026-02",
        depth: 1,
        visibility: "public",
        statusIds: publicStatuses,
        maxNodes: 50,
      });

    assert.ok(graph);
    assert.ok(
      graph.edges.some(
        (edge) =>
          edge.relationshipTypeId ===
            "supersedes" &&
          edge.toRecordId ===
            "demo-interpretation-2025-01",
      ),
    );
    assert.equal(
      graph.edges.filter(
        (edge) =>
          edge.relationshipTypeId ===
          "interprets-authority",
      ).length,
      2,
    );
    assert.ok(
      graph.edges.some(
        (edge) =>
          edge.relationshipTypeId ===
          "issued-by",
      ),
    );

    const deadlines =
      new PostgresDeadlineService(pool);
    const recordDeadlines =
      await deadlines.listForRecord(
        config.registry.id,
        "demo-interpretation-2026-02",
      );

    assert.equal(recordDeadlines.length, 1);
    assert.equal(
      recordDeadlines[0]?.deadlineTypeId,
      "declassification_review_due",
    );
    assert.equal(
      recordDeadlines[0]?.state,
      "open",
    );
    assert.equal(
      recordDeadlines[0]?.dueAt.slice(
        0,
        10,
      ),
      "2031-08-25",
    );

    const configs =
      new PostgresRegistryConfigRepository(pool);
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
        "demo-interpretation-2026-02",
        {
          visibility: "public",
        },
      );

    assert.equal(evidence.length, 2);
    assert.ok(
      evidence.every(
        (item) =>
          item.source &&
          item.document?.mimeType ===
            "application/pdf",
      ),
    );

    const integrityService =
      new PostgresIntegrityService(pool);
    const beforeImport =
      await integrityService.verifyRegistry(
        config.registry.id,
      );

    assert.equal(beforeImport.valid, true);
    assert.equal(
      beforeImport.sourceCount,
      beforeImport.entryCount,
    );

    const profile = parseIngestionProfile(
      profileSource,
      compiled,
    );
    const ingestion =
      new PostgresIngestionService(pool);
    const imported = await ingestion.run({
      registryId: config.registry.id,
      profile,
      format: "csv",
      input: importSource,
      sourceLabel:
        "Open Legal Interpretations demonstration CSV",
      sourceUri:
        "examples/open-legal-interpretations/import.csv",
      actorId:
        "system:reference-app-test",
      reason:
        "Verify reusable ingestion for the Open Legal Interpretations reference application.",
      now:
        "2026-10-06T16:30:00.000Z",
    });

    assert.equal(
      imported.run.status,
      "completed",
    );
    assert.equal(
      imported.run.createdItems,
      1,
    );
    assert.equal(
      imported.run.failedItems,
      0,
    );

    const importedSearch =
      await search.search(
        compiled,
        {
          registryId:
            config.registry.id,
          projection: "public",
          text: "records retention",
          recordTypeId:
            "interpretation",
          statuses: publicStatuses,
          visibility: "public",
          pageSize: 20,
        },
      );

    assert.equal(
      importedSearch.total,
      1,
    );
    assert.equal(
      importedSearch.hits[0]?.record.id,
      "demo-imported-interpretation-2026-03",
    );

    const importedDeadlines =
      await deadlines.listForRecord(
        config.registry.id,
        "demo-imported-interpretation-2026-03",
      );

    assert.equal(
      importedDeadlines[0]?.deadlineTypeId,
      "declassification_review_due",
    );
    assert.equal(
      importedDeadlines[0]?.dueAt.slice(
        0,
        10,
      ),
      "2031-09-20",
    );

    const afterImport =
      await integrityService.verifyRegistry(
        config.registry.id,
      );

    assert.equal(afterImport.valid, true);
    assert.ok(
      afterImport.entryCount >
        beforeImport.entryCount,
    );
  } finally {
    await pool.end();
  }
});
