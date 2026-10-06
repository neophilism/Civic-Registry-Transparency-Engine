import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseRegistryConfig,
} from "../packages/config/src/index.ts";
import {
  createDatabasePool,
  PersistenceConflictError,
  PostgresCitationRepository,
  PostgresDocumentRepository,
  PostgresRecordRepository,
  PostgresRegistryConfigRepository,
  PostgresSourceRepository,
  runMigrations,
  seedRegistry,
} from "../packages/database/src/index.ts";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for evidence integration tests.");
}

const config = parseRegistryConfig(
  await readFile(
    "examples/generic-registry/registry.yaml",
    "utf8",
  ),
  {
    sourceName: "examples/generic-registry/registry.yaml",
  },
);
const seed = JSON.parse(
  await readFile(
    "examples/generic-registry/seed.json",
    "utf8",
  ),
);

async function setup() {
  const pool = createDatabasePool({
    connectionString: databaseUrl,
    applicationName: "civic-registry-evidence-tests",
  });

  await runMigrations(pool);
  await pool.query(
    "TRUNCATE civic_registry_configurations CASCADE",
  );

  const configs = new PostgresRegistryConfigRepository(pool);
  const records = new PostgresRecordRepository(pool, configs);
  const sources = new PostgresSourceRepository(pool, configs);
  const documents = new PostgresDocumentRepository(
    pool,
    configs,
    sources,
  );
  const citations = new PostgresCitationRepository(
    pool,
    configs,
    records,
    sources,
    documents,
  );

  await seedRegistry(pool, config, seed);

  return {
    pool,
    configs,
    records,
    sources,
    documents,
    citations,
  };
}

test("evidence repositories persist and resolve field-level provenance", async () => {
  const { pool, citations } = await setup();

  try {
    const evidence = await citations.listEvidenceForRecord(
      config.registry.id,
      "example-report",
      {
        visibility: "public",
      },
    );

    assert.equal(evidence.length, 1);
    assert.equal(
      evidence[0].citation.fieldId,
      "summary",
    );
    assert.equal(
      evidence[0].source?.id,
      "example-report-source",
    );
    assert.equal(
      evidence[0].document?.id,
      "example-report-pdf",
    );
    assert.equal(
      evidence[0].citation.locator?.page,
      1,
    );
  } finally {
    await pool.end();
  }
});

test("document-only citations inherit the document provenance source in evidence bundles", async () => {
  const { pool, citations } = await setup();

  try {
    await citations.create({
      id: "document-only",
      registryId: config.registry.id,
      recordId: "example-report",
      documentId: "example-report-pdf",
      visibility: "public",
      createdAt: "2026-01-16T10:00:00.000Z",
    });

    const evidence = await citations.listEvidenceForRecord(
      config.registry.id,
      "example-report",
      {
        visibility: "public",
      },
    );
    const citation = evidence.find(
      (item) => item.citation.id === "document-only",
    );

    assert.ok(citation);
    assert.equal(
      citation.source?.id,
      "example-report-source",
    );
    assert.equal(
      citation.document?.id,
      "example-report-pdf",
    );
  } finally {
    await pool.end();
  }
});

test("public evidence cannot expose hidden sources or documents", async () => {
  const {
    pool,
    sources,
    documents,
    citations,
  } = await setup();

  try {
    await sources.create({
      id: "private-source",
      registryId: config.registry.id,
      title: "Private source",
      sourceType: "document",
      visibility: "private",
      createdAt: "2026-01-17T00:00:00.000Z",
    });

    await assert.rejects(
      () =>
        documents.create({
          id: "bad-public-document",
          registryId: config.registry.id,
          title: "Bad public document",
          visibility: "public",
          sourceId: "private-source",
          createdAt: "2026-01-17T00:01:00.000Z",
        }),
      PersistenceConflictError,
    );

    await documents.create({
      id: "private-document",
      registryId: config.registry.id,
      title: "Private document",
      visibility: "private",
      createdAt: "2026-01-17T00:02:00.000Z",
    });

    await assert.rejects(
      () =>
        citations.create({
          id: "bad-public-citation",
          registryId: config.registry.id,
          recordId: "example-report",
          documentId: "private-document",
          visibility: "public",
          createdAt: "2026-01-17T00:03:00.000Z",
        }),
      PersistenceConflictError,
    );

    await citations.create({
      id: "private-citation",
      registryId: config.registry.id,
      recordId: "example-report",
      documentId: "private-document",
      visibility: "private",
      createdAt: "2026-01-17T00:04:00.000Z",
    });

    const publicEvidence =
      await citations.listEvidenceForRecord(
        config.registry.id,
        "example-report",
        {
          visibility: "public",
        },
      );

    assert.ok(
      !publicEvidence.some(
        (item) =>
          item.citation.id === "private-citation",
      ),
    );
  } finally {
    await pool.end();
  }
});

test("citation validation rejects unknown fields and locators beyond document bounds", async () => {
  const { pool, citations } = await setup();

  try {
    await assert.rejects(
      () =>
        citations.create({
          id: "unknown-field",
          registryId: config.registry.id,
          recordId: "example-report",
          fieldId: "does_not_exist",
          documentId: "example-report-pdf",
          visibility: "public",
          createdAt: "2026-01-18T00:00:00.000Z",
        }),
      /Citation is invalid/,
    );

    await assert.rejects(
      () =>
        citations.create({
          id: "page-too-high",
          registryId: config.registry.id,
          recordId: "example-report",
          documentId: "example-report-pdf",
          locator: {
            page: 13,
          },
          visibility: "public",
          createdAt: "2026-01-18T00:01:00.000Z",
        }),
      PersistenceConflictError,
    );
  } finally {
    await pool.end();
  }
});

test("evidence seed data is idempotent", async () => {
  const { pool } = await setup();

  try {
    const result = await seedRegistry(
      pool,
      config,
      seed,
    );

    assert.equal(result.sourcesUpdated, 1);
    assert.equal(result.documentsUpdated, 1);
    assert.equal(result.citationsUpdated, 1);

    const counts = await pool.query(
      `
        SELECT
          (SELECT COUNT(*)::int FROM civic_registry_sources) AS sources,
          (SELECT COUNT(*)::int FROM civic_registry_documents) AS documents,
          (SELECT COUNT(*)::int FROM civic_registry_citations) AS citations
      `,
    );

    assert.deepEqual(counts.rows[0], {
      sources: 1,
      documents: 1,
      citations: 1,
    });
  } finally {
    await pool.end();
  }
});


test("public provenance cannot be hidden while public dependents still reference it", async () => {
  const {
    pool,
    sources,
    documents,
  } = await setup();

  try {
    const source = await sources.get(
      config.registry.id,
      "example-report-source",
    );
    const document = await documents.get(
      config.registry.id,
      "example-report-pdf",
    );

    assert.ok(source);
    assert.ok(document);

    await assert.rejects(
      () =>
        sources.update({
          ...source,
          visibility: "private",
        }),
      PersistenceConflictError,
    );

    await assert.rejects(
      () =>
        documents.update({
          ...document,
          visibility: "private",
        }),
      PersistenceConflictError,
    );
  } finally {
    await pool.end();
  }
});
