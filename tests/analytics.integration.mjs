import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseRegistryConfig,
} from "../packages/config/src/index.ts";
import {
  createDatabasePool,
  PostgresAnalyticsRepository,
  PostgresRecordRepository,
  PostgresRegistryConfigRepository,
  runMigrations,
} from "../packages/database/src/index.ts";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required for database integration tests.",
  );
}

const configSource = await readFile(
  "examples/generic-registry/registry.yaml",
  "utf8",
);
const config = parseRegistryConfig(configSource, {
  sourceName:
    "examples/generic-registry/registry.yaml",
});

test("public analytics aggregate the disclosure-safe field projection", async () => {
  const pool = createDatabasePool({
    connectionString: databaseUrl,
    applicationName:
      "civic-registry-analytics-integration-tests",
  });

  try {
    await runMigrations(pool);
    await pool.query(
      "TRUNCATE civic_registry_configurations CASCADE",
    );

    const configs =
      new PostgresRegistryConfigRepository(pool);
    const records = new PostgresRecordRepository(
      pool,
      configs,
    );
    const analytics =
      new PostgresAnalyticsRepository(pool);

    await configs.upsert(config);

    for (const [id, documentType] of [
      ["analytics-visible", "report"],
      ["analytics-redacted", "policy"],
    ]) {
      await records.create(
        {
          id,
          registryId: config.registry.id,
          recordTypeId: "document",
          fields: {
            title: id,
            document_type: documentType,
            published_on: "2026-10-01",
          },
          status: "published",
          visibility: "public",
          externalIdentifiers: [],
          tags: [],
          createdAt: "2026-10-01T12:00:00.000Z",
          updatedAt: "2026-10-01T12:00:00.000Z",
          publishedAt: "2026-10-01T12:00:00.000Z",
        },
        {
          bootstrapLifecycle: true,
        },
      );
    }

    await pool.query(
      `
        INSERT INTO civic_registry_field_disclosures (
          registry_id,
          record_id,
          field_id,
          disposition,
          updated_at
        )
        VALUES ($1, $2, $3, 'redacted', NOW())
      `,
      [
        config.registry.id,
        "analytics-redacted",
        "document_type",
      ],
    );

    const internal =
      await analytics.getRegistryAnalytics(
        config.registry.id,
        {
          scope: "internal",
          dimensionFieldId: "document_type",
          dimensionRecordTypeId: "document",
        },
      );
    const publicResult =
      await analytics.getRegistryAnalytics(
        config.registry.id,
        {
          scope: "public",
          publicStatusIds: ["published"],
          publicDeadlineTypeIds: ["review_due"],
          dimensionFieldId: "document_type",
          dimensionRecordTypeId: "document",
        },
      );

    assert.deepEqual(
      internal.dimension?.values,
      [
        { key: "policy", count: 1 },
        { key: "report", count: 1 },
      ],
    );
    assert.deepEqual(
      publicResult.dimension?.values,
      [{ key: "report", count: 1 }],
    );
    assert.equal(publicResult.totals.records, 2);
  } finally {
    await pool.end();
  }
});
