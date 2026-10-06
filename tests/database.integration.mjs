import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseRegistryConfig,
} from "../packages/config/src/index.ts";
import {
  createDatabasePool,
  PersistenceNotFoundError,
  PostgresRecordRepository,
  PostgresRegistryConfigRepository,
  PostgresRelationshipRepository,
  runMigrations,
  seedRegistry,
} from "../packages/database/src/index.ts";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for database integration tests.");
}

const configSource = await readFile(
  "examples/generic-registry/registry.yaml",
  "utf8",
);
const config = parseRegistryConfig(configSource, {
  sourceName: "examples/generic-registry/registry.yaml",
});
const seed = JSON.parse(
  await readFile(
    "examples/generic-registry/seed.json",
    "utf8",
  ),
);

function makeRecord(overrides = {}) {
  return {
    id: "integration-org",
    registryId: config.registry.id,
    recordTypeId: "organization",
    fields: {
      name: "Integration Test Agency",
      website: "https://integration.example.gov",
    },
    status: "published",
    visibility: "public",
    tags: ["integration"],
    externalIdentifiers: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    publishedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("PostgreSQL repositories support registry, record, and relationship lifecycle", async () => {
  const pool = createDatabasePool({
    connectionString: databaseUrl,
    applicationName: "civic-registry-integration-tests",
  });

  try {
    await runMigrations(pool);
    await pool.query(
      "TRUNCATE civic_registry_configurations CASCADE",
    );

    const configs = new PostgresRegistryConfigRepository(pool);
    const records = new PostgresRecordRepository(pool, configs);
    const relationships = new PostgresRelationshipRepository(
      pool,
      configs,
      records,
    );

    await configs.upsert(config);
    assert.equal(
      (await configs.get(config.registry.id))?.registry.name,
      "Public Document Catalog",
    );

    const organization = await records.create(makeRecord());
    assert.equal(
      organization.fields.name,
      "Integration Test Agency",
    );

    const document = await records.create({
      id: "integration-doc",
      registryId: config.registry.id,
      recordTypeId: "document",
      fields: {
        title: "Integration Report",
        summary: "Stored through the generic repository.",
        document_type: "report",
        published_on: "2026-01-01",
        publisher: organization.id,
      },
      status: "published",
      visibility: "public",
      tags: ["integration", "report"],
      externalIdentifiers: [],
      createdAt: "2026-01-01T00:01:00.000Z",
      updatedAt: "2026-01-01T00:01:00.000Z",
      publishedAt: "2026-01-01T00:01:00.000Z",
    });

    const relationship = await relationships.create({
      id: "integration-published-by",
      registryId: config.registry.id,
      relationshipTypeId: "published-by",
      fromRecordId: document.id,
      toRecordId: organization.id,
      createdAt: "2026-01-01T00:02:00.000Z",
      metadata: {
        source: "integration-test"
      },
    });

    assert.equal(
      relationship.relationshipTypeId,
      "published-by",
    );
    assert.equal(
      (
        await relationships.list(config.registry.id, {
          recordId: document.id,
        })
      ).length,
      1,
    );

    const publishedDocuments = await records.list(
      config.registry.id,
      {
        recordTypeId: "document",
        status: "published",
        visibility: "public",
      },
    );
    assert.equal(publishedDocuments.length, 1);

    const updated = await records.update({
      ...document,
      fields: {
        ...document.fields,
        title: "Updated Integration Report",
      },
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    assert.equal(
      updated.fields.title,
      "Updated Integration Report",
    );

    await assert.rejects(
      () =>
        relationships.create({
          id: "wrong-direction",
          registryId: config.registry.id,
          relationshipTypeId: "published-by",
          fromRecordId: organization.id,
          toRecordId: document.id,
          createdAt: "2026-01-02T00:00:00.000Z",
        }),
      /not allowed as the source/,
    );

    assert.equal(
      await records.delete(config.registry.id, organization.id),
      true,
    );
    assert.equal(
      await relationships.get(
        config.registry.id,
        relationship.id,
      ),
      null,
    );

    await assert.rejects(
      () =>
        records.create({
          ...makeRecord({
            id: "missing-registry",
            registryId: "not-installed",
          }),
        }),
      PersistenceNotFoundError,
    );
  } finally {
    await pool.end();
  }
});

test("seedRegistry is repeatable for the same registry and IDs", async () => {
  const pool = createDatabasePool({
    connectionString: databaseUrl,
    applicationName: "civic-registry-seed-tests",
  });

  try {
    await runMigrations(pool);
    await pool.query(
      "TRUNCATE civic_registry_configurations CASCADE",
    );

    const first = await seedRegistry(pool, config, seed);
    const second = await seedRegistry(pool, config, seed);

    assert.equal(first.recordsCreated, 2);
    assert.equal(first.relationshipsCreated, 1);
    assert.equal(second.recordsUpdated, 2);
    assert.equal(second.relationshipsReplaced, 1);

    const recordCount = await pool.query(
      "SELECT COUNT(*)::int AS count FROM civic_registry_records",
    );
    const relationshipCount = await pool.query(
      "SELECT COUNT(*)::int AS count FROM civic_registry_relationships",
    );

    assert.equal(recordCount.rows[0].count, 2);
    assert.equal(relationshipCount.rows[0].count, 1);
  } finally {
    await pool.end();
  }
});
