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
  createDatabasePool,
  PostgresAdminRepository,
  PostgresIngestionService,
  PostgresSourceRefreshService,
  runMigrations,
  seedRegistry,
} from "../packages/database/src/index.ts";
import {
  serializeAdapterRows,
  sha256String,
} from "../packages/source-adapters/src/index.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for database integration tests.");
}

const [configSource, seedSource, profileSource] = await Promise.all([
  readFile("examples/generic-registry/registry.yaml", "utf8"),
  readFile("examples/generic-registry/seed.json", "utf8"),
  readFile("examples/generic-registry/import-profile.yaml", "utf8"),
]);

const config = parseRegistryConfig(configSource, {
  sourceName: "examples/generic-registry/registry.yaml",
});
const compiled = compileRegistryConfig(config);
const seed = JSON.parse(seedSource);
const profile = parseIngestionProfile(profileSource, compiled);

function rows(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: "refresh-record-" + String(index + 1),
    external_id: "refresh:" + String(index + 1),
    title: "Refresh record " + String(index + 1),
    summary: "Synthetic refresh fixture",
    type: "report",
    published_on: "2026-10-07",
    canonical_url:
      "https://example.gov/refresh/" + String(index + 1),
    source_adapter: "refresh-test",
    retrieved_at: "2026-10-07T18:00:00.000Z",
  }));
}

test("scheduled source refreshes are leased, monitored, ingested, and backed off", async () => {
  const pool = createDatabasePool({
    connectionString: databaseUrl,
    applicationName: "civic-registry-source-refresh-tests",
  });

  try {
    await runMigrations(pool);
    await pool.query(
      "TRUNCATE civic_registry_configurations CASCADE",
    );
    await seedRegistry(pool, config, seed);

    const service = new PostgresSourceRefreshService(pool);
    const competing = new PostgresSourceRefreshService(pool);
    const ingestion = new PostgresIngestionService(pool);
    const definition = {
      id: "test-refresh",
      registryId: config.registry.id,
      label: "Test public source refresh",
      adapterId: "refresh-test",
      profileId: profile.id,
      enabled: true,
      intervalSeconds: 3600,
      staleAfterSeconds: 7200,
      failureBackoffBaseSeconds: 60,
      failureBackoffMaxSeconds: 600,
      emptyResultBehavior: "allow",
      rowCountDropWarningPercent: 50,
      adapterOptions: { maxItems: 100 },
    };
    const initialNow = "2026-10-07T18:00:00.000Z";

    await service.syncDefinitions(
      config.registry.id,
      [definition],
      { now: initialNow },
    );

    const initialHealth = await service.listHealth(
      config.registry.id,
      initialNow,
    );
    assert.equal(initialHealth[0]?.status, "never_run");

    let releaseFirst;
    const firstGate = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    let markEntered;
    const entered = new Promise((resolve) => {
      markEntered = resolve;
    });

    const firstRun = service.runDue({
      registryId: config.registry.id,
      now: initialNow,
      leaseSeconds: 600,
      executor: async (claim) => {
        markEntered();
        await firstGate;
        const output = serializeAdapterRows(rows(10));
        const ingested = await ingestion.run({
          registryId: config.registry.id,
          profile,
          format: "ndjson",
          input: output,
          sourceLabel: claim.job.label,
          sourceUri: "https://example.gov/refresh",
          actorId: "system:source-refresh-test",
          reason: "First scheduled refresh.",
          metadata: {
            sourceRefreshJobId: claim.job.id,
            sourceRefreshRunId: claim.run.id,
          },
        });

        return {
          manifest: {
            formatVersion: 1,
            adapterId: claim.job.adapterId,
            adapterLabel: claim.job.label,
            retrievedAt: initialNow,
            rowCount: 10,
            sourcePages: ["https://example.gov/refresh"],
            warnings: [],
            outputSha256: sha256String(output),
          },
          ingestionRunId: ingested.run.id,
          ingestionStatus: ingested.run.status,
          ingestionFailedItems: ingested.run.failedItems,
        };
      },
    });

    await entered;

    const secondWorker = await competing.runDue({
      registryId: config.registry.id,
      now: "2026-10-07T18:00:30.000Z",
      leaseSeconds: 600,
      executor: async () => {
        throw new Error("Second worker must not claim the leased job.");
      },
    });
    assert.equal(secondWorker.claimed, 0);

    releaseFirst();
    const first = await firstRun;
    assert.equal(first.claimed, 1);
    assert.equal(first.completed, 1);
    assert.equal(first.failed, 0);
    assert.equal(first.runs[0]?.rowCount, 10);

    const queued = await service.queueNow(
      config.registry.id,
      definition.id,
    );
    const secondOutput = serializeAdapterRows(rows(2));
    const second = await service.runDue({
      registryId: config.registry.id,
      now: queued.nextRunAt,
      executor: async (claim) => {
        const ingested = await ingestion.run({
          registryId: config.registry.id,
          profile,
          format: "ndjson",
          input: secondOutput,
          sourceLabel: claim.job.label,
          sourceUri: "https://example.gov/refresh",
          actorId: "system:source-refresh-test",
          reason: "Row-count drop refresh.",
        });
        return {
          manifest: {
            formatVersion: 1,
            adapterId: claim.job.adapterId,
            adapterLabel: claim.job.label,
            retrievedAt: queued.nextRunAt,
            rowCount: 2,
            sourcePages: ["https://example.gov/refresh"],
            warnings: [],
            outputSha256: sha256String(secondOutput),
          },
          ingestionRunId: ingested.run.id,
          ingestionStatus: ingested.run.status,
          ingestionFailedItems: ingested.run.failedItems,
        };
      },
    });

    assert.equal(second.completedWithWarnings, 1);
    assert.equal(second.runs[0]?.rowCountDelta, -8);
    assert.ok(
      second.runs[0]?.warnings.some(
        (warning) =>
          warning.code === "source_refresh_row_count_drop",
      ),
    );

    const queuedFailure = await service.queueNow(
      config.registry.id,
      definition.id,
    );
    const failure = await service.runDue({
      registryId: config.registry.id,
      now: queuedFailure.nextRunAt,
      executor: async () => {
        throw new Error("Synthetic adapter outage.");
      },
    });
    assert.equal(failure.failed, 1);

    const summary = await new PostgresAdminRepository(
      pool,
    ).getRegistrySummary(config.registry.id);
    assert.equal(summary.sourceRefreshJobCount, 1);
    assert.equal(summary.sourceRefreshIssueCount, 1);

    await service.setEnabled(
      config.registry.id,
      definition.id,
      false,
    );
    const disabled = await service.listHealth(
      config.registry.id,
    );
    assert.equal(disabled[0]?.status, "disabled");
  } finally {
    await pool.end();
  }
});
