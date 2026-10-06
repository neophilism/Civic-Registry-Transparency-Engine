import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseRegistryConfig,
} from "../packages/config/src/index.ts";
import {
  createDatabasePool,
  PostgresAdminRepository,
  PostgresRecordHistoryRepository,
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

test("administrator repository summarizes operations and record writes preserve actor attribution", async () => {
  const pool = createDatabasePool({
    connectionString: databaseUrl,
    applicationName:
      "civic-registry-admin-integration-tests",
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
    const history =
      new PostgresRecordHistoryRepository(pool);
    const admin = new PostgresAdminRepository(pool);

    await configs.upsert(config);

    const created = await records.create(
      {
        id: "admin-record",
        registryId: config.registry.id,
        recordTypeId: "organization",
        fields: {
          name: "Administrative Test Office",
        },
        status: "draft",
        visibility: "private",
        externalIdentifiers: [],
        tags: ["admin-test"],
        createdAt: "2026-10-06T12:00:00.000Z",
        updatedAt: "2026-10-06T12:00:00.000Z",
      },
      {
        context: {
          actorId: "operator@example.org",
          reason: "Created in administrator console.",
        },
      },
    );

    await records.update(
      {
        ...created,
        fields: {
          ...created.fields,
          name: "Updated Administrative Test Office",
        },
        updatedAt: "2026-10-06T12:05:00.000Z",
      },
      {
        context: {
          actorId: "operator@example.org",
          reason: "Corrected the canonical title.",
        },
      },
    );

    const versions = await history.listVersions(
      config.registry.id,
      created.id,
      { limit: 10 },
    );

    assert.equal(versions.length, 2);
    assert.equal(
      versions[0].actorId,
      "operator@example.org",
    );
    assert.equal(
      versions[0].reason,
      "Corrected the canonical title.",
    );
    assert.equal(
      versions[1].actorId,
      "operator@example.org",
    );
    assert.equal(
      versions[1].reason,
      "Created in administrator console.",
    );

    const summary = await admin.getRegistrySummary(
      config.registry.id,
    );

    assert.equal(summary.recordCount, 1);
    assert.equal(summary.pendingApprovalCount, 0);
    assert.equal(summary.failedIngestionItemCount, 0);
    assert.equal(summary.overdueDeadlineCount, 0);
  } finally {
    await pool.end();
  }
});
