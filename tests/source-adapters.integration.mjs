import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  compileRegistryConfig,
  parseRegistryConfig,
} from "../packages/config/src/index.ts";
import {
  parseIngestionProfile,
} from "../packages/ingestion/src/index.ts";
import {
  serializeAdapterRows,
} from "../packages/source-adapters/src/index.ts";
import {
  createDatabasePool,
  PostgresIngestionService,
  PostgresIntegrityService,
  PostgresRecordRepository,
  PostgresRegistryConfigRepository,
  runMigrations,
  seedRegistry,
} from "../packages/database/src/index.ts";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required for database integration tests.",
  );
}

const [configSource, seedSource, profileSource] =
  await Promise.all([
    readFile(
      "examples/generic-registry/registry.yaml",
      "utf8",
    ),
    readFile(
      "examples/generic-registry/seed.json",
      "utf8",
    ),
    readFile(
      "examples/generic-registry/import-profile.yaml",
      "utf8",
    ),
  ]);

const config = parseRegistryConfig(configSource, {
  sourceName: "examples/generic-registry/registry.yaml",
});
const compiled = compileRegistryConfig(config);
const seed = JSON.parse(seedSource);
const profile = parseIngestionProfile(
  profileSource,
  compiled,
);

test("generic source adapter output ingests through the standard registry pipeline", async () => {
  const pool = createDatabasePool({
    connectionString: databaseUrl,
    applicationName:
      "civic-registry-source-adapter-integration-tests",
  });

  try {
    await runMigrations(pool);
    await pool.query(
      "TRUNCATE civic_registry_configurations CASCADE",
    );
    await seedRegistry(pool, config, seed);

    const row = {
      id: "adapter-example-report",
      external_id: "example-source:adapter-report",
      title: "Adapter Example Report",
      summary: "Imported through the generic adapter boundary.",
      type: "report",
      published_on: "2026-10-07",
      canonical_url:
        "https://example.gov/reports/adapter-example",
      source_adapter: "example-adapter",
      retrieved_at: "2026-10-07T16:00:00.000Z",
    };
    const input = serializeAdapterRows([row]);
    const service = new PostgresIngestionService(pool);
    const before = await new PostgresIntegrityService(
      pool,
    ).verifyRegistry(config.registry.id);

    const result = await service.run({
      registryId: config.registry.id,
      profile,
      format: "ndjson",
      input,
      sourceLabel: "Generic adapter fixture",
      sourceUri: "https://example.gov/reports",
      actorId: "system:public-source-adapter-test",
      reason:
        "Verify provider-neutral adapter rows use the generic ingestion boundary.",
      now: "2026-10-07T16:05:00.000Z",
    });

    assert.equal(result.run.status, "completed");
    assert.equal(result.run.createdItems, 1);
    assert.equal(result.run.failedItems, 0);

    const configs =
      new PostgresRegistryConfigRepository(pool);
    const records =
      new PostgresRecordRepository(pool, configs);
    const record = await records.get(
      config.registry.id,
      row.id,
    );

    assert.ok(record);
    assert.equal(
      record.fields.title,
      "Adapter Example Report",
    );
    assert.equal(record.status, "published");
    assert.equal(record.visibility, "public");

    const after = await new PostgresIntegrityService(
      pool,
    ).verifyRegistry(config.registry.id);

    assert.equal(after.valid, true);
    assert.ok(after.entryCount > before.entryCount);
  } finally {
    await pool.end();
  }
});
