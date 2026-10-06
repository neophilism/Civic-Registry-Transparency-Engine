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
  serializeAdapterRows,
} from "../packages/source-adapters/src/index.ts";
import {
  parseDojOlcOpinion,
} from "../examples/open-legal-interpretations/adapters/doj-olc.ts";
import {
  createDatabasePool,
  PostgresIngestionService,
  PostgresIntegrityService,
  PostgresRecordRepository,
  PostgresRegistryConfigRepository,
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
  profileSource,
  detailHtml,
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
    "examples/open-legal-interpretations/adapter-import-profile.yaml",
    "utf8",
  ),
  readFile(
    "tests/fixtures/source-adapters/doj-olc-detail.html",
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
const compiled =
  compileRegistryConfig(config);
const seed = JSON.parse(seedSource);
const profile =
  parseIngestionProfile(
    profileSource,
    compiled,
  );

test("official source adapter output ingests through the existing registry pipeline", async () => {
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
    await seedRegistry(
      pool,
      config,
      seed,
    );

    const row = parseDojOlcOpinion(
      detailHtml,
      "https://www.justice.gov/olc/opinion/example-separation-powers-opinion",
      "2026-10-06T17:00:00.000Z",
    );
    const input =
      serializeAdapterRows([row]);
    const service =
      new PostgresIngestionService(pool);
    const before =
      await new PostgresIntegrityService(
        pool,
      ).verifyRegistry(
        config.registry.id,
      );

    const result = await service.run({
      registryId:
        config.registry.id,
      profile,
      format: "ndjson",
      input,
      sourceLabel:
        "DOJ OLC source adapter fixture",
      sourceUri:
        "https://www.justice.gov/olc/opinions",
      actorId:
        "system:public-source-adapter-test",
      reason:
        "Verify public source adapter rows use the generic ingestion boundary.",
      now:
        "2026-10-06T17:05:00.000Z",
    });

    assert.equal(
      result.run.status,
      "completed",
    );
    assert.equal(
      result.run.createdItems,
      1,
    );
    assert.equal(
      result.run.failedItems,
      0,
    );

    const configs =
      new PostgresRegistryConfigRepository(
        pool,
      );
    const records =
      new PostgresRecordRepository(
        pool,
        configs,
      );
    const record = await records.get(
      config.registry.id,
      "doj-olc-example-separation-powers-opinion",
    );

    assert.ok(record);
    assert.equal(
      record.fields.issuing_body,
      "usdoj-office-of-legal-counsel",
    );
    assert.equal(
      record.fields.issued_on,
      "2026-09-17",
    );
    assert.equal(
      record.status,
      "published",
    );
    assert.equal(
      record.visibility,
      "public",
    );
    assert.equal(
      record.publishedAt,
      undefined,
    );
    assert.deepEqual(
      record.externalIdentifiers,
      [
        {
          scheme:
            "official-source",
          value:
            "doj-olc:example-separation-powers-opinion",
          url:
            "https://www.justice.gov/olc/opinion/example-separation-powers-opinion",
        },
      ],
    );

    const after =
      await new PostgresIntegrityService(
        pool,
      ).verifyRegistry(
        config.registry.id,
      );

    assert.equal(after.valid, true);
    assert.ok(
      after.entryCount >
        before.entryCount,
    );
  } finally {
    await pool.end();
  }
});
