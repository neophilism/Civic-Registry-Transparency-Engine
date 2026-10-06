import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  compileRegistryConfig,
  parseRegistryConfig,
} from "../packages/config/src/index.ts";
import {
  createDatabasePool,
  PostgresDeadlineService,
  PostgresRecordRepository,
  PostgresRegistryAnalyticsRepository,
  PostgresRegistryConfigRepository,
  runMigrations,
  seedRegistry,
} from "../packages/database/src/index.ts";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required for analytics integration tests.",
  );
}

const config = parseRegistryConfig(
  await readFile(
    "examples/generic-registry/registry.yaml",
    "utf8",
  ),
  {
    sourceName:
      "examples/generic-registry/registry.yaml",
  },
);
const seed = JSON.parse(
  await readFile(
    "examples/generic-registry/seed.json",
    "utf8",
  ),
);

test("analytics preserve public disclosure boundaries while administrative scope sees canonical operations", async () => {
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
    await seedRegistry(pool, config, seed);

    const configs =
      new PostgresRegistryConfigRepository(pool);
    const deadlines =
      new PostgresDeadlineService(pool);
    const records =
      new PostgresRecordRepository(
        pool,
        configs,
        deadlines,
      );
    const analytics =
      new PostgresRegistryAnalyticsRepository(pool);
    const compiled =
      compileRegistryConfig(config);

    await records.create({
      id: "internal-office",
      registryId: config.registry.id,
      recordTypeId: "organization",
      fields: {
        name: "Internal Office",
      },
      status: "draft",
      visibility: "private",
      externalIdentifiers: [],
      tags: ["internal"],
      createdAt: "2026-01-18T10:00:00.000Z",
      updatedAt: "2026-01-18T10:00:00.000Z",
    });

    await records.create({
      id: "internal-report",
      registryId: config.registry.id,
      recordTypeId: "document",
      fields: {
        title: "Internal Working Report",
        summary: "Not publicly released.",
        document_type: "policy",
        published_on: "2026-01-18",
        publisher: "internal-office",
      },
      status: "draft",
      visibility: "private",
      externalIdentifiers: [],
      tags: ["internal"],
      createdAt: "2026-01-18T10:05:00.000Z",
      updatedAt: "2026-01-18T10:05:00.000Z",
    });

    const publicSnapshot =
      await analytics.getSnapshot(
        compiled,
        {
          scope: "public",
          now: "2026-01-20T12:00:00.000Z",
        },
      );
    const adminSnapshot =
      await analytics.getSnapshot(
        compiled,
        {
          scope: "administrative",
          now: "2026-01-20T12:00:00.000Z",
        },
      );

    assert.equal(publicSnapshot.totalRecords, 2);
    assert.equal(adminSnapshot.totalRecords, 4);

    assert.deepEqual(
      publicSnapshot.byStatus.map(
        ({ id, count }) => ({ id, count }),
      ),
      [{ id: "published", count: 2 }],
    );
    assert.ok(
      adminSnapshot.byStatus.some(
        (item) =>
          item.id === "draft" &&
          item.count === 2,
      ),
    );

    const publicPublisher =
      publicSnapshot.dimensions.find(
        (dimension) =>
          dimension.id === "publisher",
      );
    const adminPublisher =
      adminSnapshot.dimensions.find(
        (dimension) =>
          dimension.id === "publisher",
      );

    assert.ok(publicPublisher);
    assert.ok(adminPublisher);
    assert.deepEqual(
      publicPublisher.values.map(
        ({ label, count }) => ({
          label,
          count,
        }),
      ),
      [
        {
          label: "Example Public Agency",
          count: 1,
        },
      ],
    );
    assert.ok(
      !publicPublisher.values.some(
        (item) =>
          item.label.includes("Internal"),
      ),
    );
    assert.ok(
      adminPublisher.values.some(
        (item) =>
          item.label === "Internal Office" &&
          item.count === 1,
      ),
    );

    assert.equal(
      publicSnapshot.evidenceCoverage
        .recordsWithEvidence,
      1,
    );
    assert.equal(
      publicSnapshot.evidenceCoverage
        .recordCoveragePercent,
      50,
    );
    assert.equal(
      publicSnapshot.evidenceCoverage
        .citedSourceCount,
      1,
    );

    assert.equal(
      publicSnapshot.deadlines.overdue,
      0,
    );
    assert.equal(
      publicSnapshot.deadlines.approaching,
      1,
    );

    assert.equal(
      publicSnapshot.publicationTrend[0]
        ?.start,
      "2026-01-01",
    );
    assert.equal(
      publicSnapshot.publicationTrend[0]
        ?.count,
      2,
    );
  } finally {
    await pool.end();
  }
});
