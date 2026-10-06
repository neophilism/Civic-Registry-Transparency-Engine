import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required for database integration tests.",
  );
}

const [configSource, seedSource] =
  await Promise.all([
    readFile(
      "examples/open-legal-interpretations/registry.yaml",
      "utf8",
    ),
    readFile(
      "examples/open-legal-interpretations/seed.json",
      "utf8",
    ),
  ]);

const config = parseRegistryConfig(configSource, {
  sourceName:
    "examples/open-legal-interpretations/registry.yaml",
});
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

    assert.equal(
      seeded.registryId,
      "open-legal-interpretations",
    );
    assert.equal(seeded.recordsCreated, 6);
    assert.equal(seeded.documentsCreated, 2);
    assert.equal(seeded.citationsCreated, 3);
    assert.equal(
      seeded.relationshipsCreated,
      6,
    );

    const compiled =
      compileRegistryConfig(config);
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
        statuses: [
          "published",
          "withdrawn",
          "superseded",
          "archived",
        ],
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
        statusIds: [
          "published",
          "withdrawn",
          "superseded",
          "archived",
        ],
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
    assert.ok(
      graph.edges.some(
        (edge) =>
          edge.relationshipTypeId ===
          "interprets-authority",
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
      recordDeadlines[0].deadlineTypeId,
      "declassification_review_due",
    );
    assert.equal(
      recordDeadlines[0].dueAt.slice(0, 10),
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
          item.document,
      ),
    );

    const integrity =
      await new PostgresIntegrityService(
        pool,
      ).verifyRegistry(
        config.registry.id,
      );

    assert.equal(integrity.valid, true);
    assert.equal(
      integrity.sourceCount,
      integrity.entryCount,
    );
  } finally {
    await pool.end();
  }
});
