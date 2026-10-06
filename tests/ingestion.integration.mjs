import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseRegistryConfig,
} from "../packages/config/src/index.ts";
import {
  createDatabasePool,
  PostgresIngestionService,
  PostgresRecordHistoryRepository,
  PostgresRecordRepository,
  PostgresRegistryConfigRepository,
  runMigrations,
} from "../packages/database/src/index.ts";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required for ingestion integration tests.",
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

function profile(overrides = {}) {
  return {
    id: "document-import",
    recordTypeId: "document",
    mode: "upsert",
    recordId: {
      path: "id",
      required: true,
      trim: true,
    },
    sourceKey: {
      path: "external_id",
      required: true,
      trim: true,
    },
    fields: {
      title: {
        path: "title",
        required: true,
        trim: true,
      },
      summary: {
        path: "summary",
        trim: true,
      },
      document_type: {
        path: "type",
        trim: true,
      },
      published_on: {
        path: "published_on",
        trim: true,
      },
    },
    status: {
      literal: "published",
    },
    visibility: {
      literal: "public",
    },
    staticTags: ["imported"],
    externalIdentifiers: [
      {
        scheme: "external-test",
        value: {
          path: "external_id",
          required: true,
        },
      },
    ],
    allowLifecycleBootstrap: true,
    ...overrides,
  };
}

async function setup() {
  const pool = createDatabasePool({
    connectionString: databaseUrl,
    applicationName:
      "civic-registry-ingestion-tests",
  });

  await runMigrations(pool);
  await pool.query(
    "TRUNCATE civic_registry_configurations CASCADE",
  );

  const configs =
    new PostgresRegistryConfigRepository(pool);
  await configs.upsert(config);

  return {
    pool,
    configs,
    service:
      new PostgresIngestionService(pool),
    records:
      new PostgresRecordRepository(
        pool,
        configs,
      ),
    history:
      new PostgresRecordHistoryRepository(pool),
  };
}

test("ingestion isolates invalid rows and records durable per-row outcomes", async () => {
  const {
    pool,
    service,
    records,
    history,
  } = await setup();

  try {
    const result = await service.run({
      registryId: config.registry.id,
      profile: profile(),
      format: "json",
      input: JSON.stringify([
        {
          id: "doc-1",
          external_id: "EXT-1",
          title: "Imported report",
          summary: "Imported summary",
          type: "report",
          published_on: "2026-02-02",
        },
        {
          id: "doc-bad",
          external_id: "EXT-BAD",
          title: "",
          type: "not-an-enum",
          published_on: "2026-02-03",
        },
      ]),
      sourceLabel: "integration.json",
      actorId: "importer-1",
      reason: "Integration import.",
      now: "2026-02-10T12:00:00.000Z",
    });

    assert.equal(
      result.run.status,
      "completed_with_errors",
    );
    assert.equal(result.run.totalItems, 2);
    assert.equal(result.run.createdItems, 1);
    assert.equal(result.run.failedItems, 1);
    assert.match(
      result.run.inputSha256,
      /^[0-9a-f]{64}$/,
    );

    const stored = await records.get(
      config.registry.id,
      "doc-1",
    );

    assert.ok(stored);
    assert.equal(
      stored.fields.title,
      "Imported report",
    );
    assert.equal(stored.status, "published");
    assert.deepEqual(stored.tags, ["imported"]);

    assert.equal(
      await records.get(
        config.registry.id,
        "doc-bad",
      ),
      null,
    );

    const items = await service.listItems(
      config.registry.id,
      result.run.id,
    );

    assert.deepEqual(
      items.map((item) => item.outcome),
      ["created", "failed"],
    );
    assert.ok(
      items[1].errorDetails.length > 0,
    );

    const events = await history.listEvents(
      config.registry.id,
      "doc-1",
      {
        eventTypes: [
          "ingestion.record_created",
        ],
      },
    );

    assert.equal(events.length, 1);
    assert.equal(
      events[0].metadata.runId,
      result.run.id,
    );
    assert.equal(
      events[0].actorId,
      "importer-1",
    );
  } finally {
    await pool.end();
  }
});

test("repeating the same upsert is idempotent and records unchanged outcome", async () => {
  const {
    pool,
    service,
    history,
  } = await setup();

  try {
    const input = JSON.stringify([
      {
        id: "doc-repeat",
        external_id: "EXT-REPEAT",
        title: "Repeatable report",
        summary: "Stable summary",
        type: "report",
        published_on: "2026-03-01",
      },
    ]);

    const first = await service.run({
      registryId: config.registry.id,
      profile: profile(),
      format: "json",
      input,
      sourceLabel: "repeat.json",
      now: "2026-03-10T12:00:00.000Z",
    });
    const versionsBefore =
      await history.listVersions(
        config.registry.id,
        "doc-repeat",
      );

    const second = await service.run({
      registryId: config.registry.id,
      profile: profile(),
      format: "json",
      input,
      sourceLabel: "repeat.json",
      now: "2026-03-11T12:00:00.000Z",
    });
    const versionsAfter =
      await history.listVersions(
        config.registry.id,
        "doc-repeat",
      );

    assert.equal(first.run.createdItems, 1);
    assert.equal(second.run.unchangedItems, 1);
    assert.equal(second.run.updatedItems, 0);
    assert.equal(
      versionsAfter.length,
      versionsBefore.length,
    );

    const items = await service.listItems(
      config.registry.id,
      second.run.id,
    );

    assert.equal(
      items[0].outcome,
      "unchanged",
    );
  } finally {
    await pool.end();
  }
});

test("partial upserts preserve fields outside the profile unless replacement is explicit", async () => {
  const {
    pool,
    service,
    records,
  } = await setup();

  try {
    await service.run({
      registryId: config.registry.id,
      profile: profile(),
      format: "json",
      input: JSON.stringify([
        {
          id: "doc-partial",
          external_id: "EXT-PARTIAL",
          title: "Original title",
          summary: "Keep this summary",
          type: "report",
          published_on: "2026-04-01",
        },
      ]),
      sourceLabel: "full.json",
      now: "2026-04-02T00:00:00.000Z",
    });

    const partialProfile = profile({
      id: "partial-document-import",
      fields: {
        title: {
          path: "title",
          required: true,
          trim: true,
        },
      },
    });

    const update = await service.run({
      registryId: config.registry.id,
      profile: partialProfile,
      format: "json",
      input: JSON.stringify([
        {
          id: "doc-partial",
          external_id: "EXT-PARTIAL",
          title: "Updated title",
        },
      ]),
      sourceLabel: "partial.json",
      now: "2026-04-03T00:00:00.000Z",
    });

    assert.equal(update.run.updatedItems, 1);

    const preserved = await records.get(
      config.registry.id,
      "doc-partial",
    );

    assert.equal(
      preserved.fields.title,
      "Updated title",
    );
    assert.equal(
      preserved.fields.summary,
      "Keep this summary",
    );
    assert.equal(
      preserved.fields.document_type,
      "report",
    );

    const replacementProfile = {
      ...partialProfile,
      id: "replacement-document-import",
      replaceFields: true,
    };

    await service.run({
      registryId: config.registry.id,
      profile: replacementProfile,
      format: "json",
      input: JSON.stringify([
        {
          id: "doc-partial",
          external_id: "EXT-PARTIAL",
          title: "Replacement title",
        },
      ]),
      sourceLabel: "replacement.json",
      now: "2026-04-04T00:00:00.000Z",
    });

    const replaced = await records.get(
      config.registry.id,
      "doc-partial",
    );

    assert.deepEqual(
      replaced.fields,
      {
        title: "Replacement title",
      },
    );
  } finally {
    await pool.end();
  }
});

test("dry runs validate rows and persist run diagnostics without mutating records", async () => {
  const {
    pool,
    service,
    records,
  } = await setup();

  try {
    const result = await service.run({
      registryId: config.registry.id,
      profile: profile(),
      format: "json",
      input: JSON.stringify([
        {
          id: "doc-dry",
          external_id: "EXT-DRY",
          title: "Dry run",
          type: "notice",
          published_on: "2026-05-01",
        },
      ]),
      sourceLabel: "dry.json",
      dryRun: true,
      now: "2026-05-02T00:00:00.000Z",
    });

    assert.equal(result.run.status, "completed");
    assert.equal(result.run.validatedItems, 1);
    assert.equal(result.run.createdItems, 0);

    assert.equal(
      await records.get(
        config.registry.id,
        "doc-dry",
      ),
      null,
    );

    const items = await service.listItems(
      config.registry.id,
      result.run.id,
    );

    assert.equal(
      items[0].outcome,
      "validated",
    );
  } finally {
    await pool.end();
  }
});

test("duplicate source identities are rejected deterministically without aborting the batch", async () => {
  const {
    pool,
    service,
    records,
  } = await setup();

  try {
    const result = await service.run({
      registryId: config.registry.id,
      profile: profile(),
      format: "json",
      input: JSON.stringify([
        {
          id: "doc-dupe-1",
          external_id: "EXT-DUPE",
          title: "First",
          type: "report",
          published_on: "2026-06-01",
        },
        {
          id: "doc-dupe-2",
          external_id: "EXT-DUPE",
          title: "Second",
          type: "report",
          published_on: "2026-06-02",
        },
      ]),
      sourceLabel: "duplicates.json",
      now: "2026-06-03T00:00:00.000Z",
    });

    assert.equal(result.run.createdItems, 1);
    assert.equal(result.run.failedItems, 1);

    const items = await service.listItems(
      config.registry.id,
      result.run.id,
    );

    assert.equal(
      items[1].errorCode,
      "duplicate_source_key",
    );
    assert.ok(
      await records.get(
        config.registry.id,
        "doc-dupe-1",
      ),
    );
    assert.equal(
      await records.get(
        config.registry.id,
        "doc-dupe-2",
      ),
      null,
    );
  } finally {
    await pool.end();
  }
});

test("upserts cannot bypass lifecycle status transitions on existing records", async () => {
  const {
    pool,
    service,
    records,
  } = await setup();

  try {
    await service.run({
      registryId: config.registry.id,
      profile: profile(),
      format: "json",
      input: JSON.stringify([
        {
          id: "doc-lifecycle",
          external_id: "EXT-LIFE",
          title: "Lifecycle document",
          type: "report",
          published_on: "2026-07-01",
        },
      ]),
      sourceLabel: "published.json",
      now: "2026-07-02T00:00:00.000Z",
    });

    const withdrawingProfile = profile({
      id: "withdraw-import",
      status: {
        literal: "withdrawn",
      },
    });
    const result = await service.run({
      registryId: config.registry.id,
      profile: withdrawingProfile,
      format: "json",
      input: JSON.stringify([
        {
          id: "doc-lifecycle",
          external_id: "EXT-LIFE",
          title: "Attempted status rewrite",
          type: "report",
          published_on: "2026-07-01",
        },
      ]),
      sourceLabel: "withdraw.json",
      now: "2026-07-03T00:00:00.000Z",
    });

    assert.equal(result.run.updatedItems, 0);
    assert.equal(result.run.failedItems, 1);

    const stored = await records.get(
      config.registry.id,
      "doc-lifecycle",
    );

    assert.equal(stored.status, "published");
    assert.equal(
      stored.fields.title,
      "Lifecycle document",
    );

    const items = await service.listItems(
      config.registry.id,
      result.run.id,
    );

    assert.equal(
      items[0].errorCode,
      "persistence_conflict",
    );
  } finally {
    await pool.end();
  }
});

test("create mode refuses collisions and run listing is filterable by profile", async () => {
  const {
    pool,
    service,
  } = await setup();

  try {
    const createProfile = profile({
      id: "create-only",
      mode: "create",
    });
    const input = JSON.stringify([
      {
        id: "doc-create",
        external_id: "EXT-CREATE",
        title: "Create only",
        type: "policy",
        published_on: "2026-08-01",
      },
    ]);

    const first = await service.run({
      registryId: config.registry.id,
      profile: createProfile,
      format: "json",
      input,
      sourceLabel: "create.json",
      now: "2026-08-02T00:00:00.000Z",
    });
    const second = await service.run({
      registryId: config.registry.id,
      profile: createProfile,
      format: "json",
      input,
      sourceLabel: "create.json",
      now: "2026-08-03T00:00:00.000Z",
    });

    assert.equal(first.run.createdItems, 1);
    assert.equal(second.run.failedItems, 1);

    const runs = await service.listRuns(
      config.registry.id,
      {
        profileId: "create-only",
      },
    );

    assert.equal(runs.length, 2);
    assert.equal(
      runs[0].profileId,
      "create-only",
    );
  } finally {
    await pool.end();
  }
});
