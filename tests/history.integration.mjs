import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  compileRegistryConfig,
  parseRegistryConfig,
} from "../packages/config/src/index.ts";
import {
  createDatabasePool,
  PostgresRecordHistoryRepository,
  PostgresRecordRepository,
  PostgresRegistryConfigRepository,
  rebuildRegistrySearchIndex,
  runMigrations,
  seedRegistry,
} from "../packages/database/src/index.ts";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for history integration tests.");
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
const compiled = compileRegistryConfig(config);
const seed = JSON.parse(
  await readFile(
    "examples/generic-registry/seed.json",
    "utf8",
  ),
);

async function setup() {
  const pool = createDatabasePool({
    connectionString: databaseUrl,
    applicationName: "civic-registry-history-tests",
  });

  await runMigrations(pool);
  await pool.query(
    "TRUNCATE civic_registry_configurations CASCADE",
  );

  await seedRegistry(pool, config, seed);

  const configs = new PostgresRegistryConfigRepository(pool);
  const records = new PostgresRecordRepository(pool, configs);
  const history = new PostgresRecordHistoryRepository(pool);

  return {
    pool,
    records,
    history,
  };
}

test("database triggers capture direct SQL revisions and ignore internal-only reindexing", async () => {
  const { pool, history } = await setup();

  try {
    const initial = await history.listVersions(
      config.registry.id,
      "example-report",
    );

    assert.equal(initial.length, 1);
    assert.equal(initial[0].operation, "created");
    assert.equal(initial[0].version, 1);

    await pool.query(
      `
        UPDATE civic_registry_records
        SET
          fields = jsonb_set(
            fields,
            '{summary}',
            to_jsonb('Updated through direct SQL'::text)
          ),
          status = 'withdrawn',
          updated_at = '2026-02-01T00:00:00.000Z'
        WHERE registry_id = $1
          AND id = 'example-report'
      `,
      [config.registry.id],
    );

    const afterUpdate = await history.listVersions(
      config.registry.id,
      "example-report",
    );

    assert.equal(afterUpdate.length, 2);
    assert.equal(afterUpdate[0].version, 2);
    assert.equal(afterUpdate[0].operation, "updated");
    assert.equal(
      afterUpdate[0].snapshot.fields.summary,
      "Updated through direct SQL",
    );
    assert.equal(
      afterUpdate[0].snapshot.status,
      "withdrawn",
    );

    const events = await history.listEvents(
      config.registry.id,
      "example-report",
      {
        visibility: "public",
      },
    );
    const eventTypes = new Set(
      events.map((event) => event.eventType),
    );

    assert.ok(eventTypes.has("record.fields_changed"));
    assert.ok(eventTypes.has("record.withdrawn"));

    await rebuildRegistrySearchIndex(
      pool,
      compiled,
    );

    const afterReindex = await history.listVersions(
      config.registry.id,
      "example-report",
    );

    assert.equal(afterReindex.length, 2);
  } finally {
    await pool.end();
  }
});

test("revision rows and audit events cannot be rewritten or deleted", async () => {
  const { pool } = await setup();

  try {
    await assert.rejects(
      () =>
        pool.query(
          `
            UPDATE civic_registry_record_versions
            SET reason = 'tampered'
            WHERE registry_id = $1
              AND record_id = 'example-report'
          `,
          [config.registry.id],
        ),
      /history is immutable/i,
    );

    await assert.rejects(
      () =>
        pool.query(
          `
            DELETE FROM civic_registry_audit_events
            WHERE registry_id = $1
              AND subject_id = 'example-report'
          `,
          [config.registry.id],
        ),
      /history is immutable/i,
    );
  } finally {
    await pool.end();
  }
});

test("relationship and evidence mutations emit record audit events", async () => {
  const { pool, history } = await setup();

  try {
    const reportEvents = await history.listEvents(
      config.registry.id,
      "example-report",
      {
        visibility: "public",
      },
    );
    const reportTypes = new Set(
      reportEvents.map((event) => event.eventType),
    );

    assert.ok(reportTypes.has("record.created"));
    assert.ok(reportTypes.has("relationship.added"));
    assert.ok(
      reportTypes.has("evidence.citation_added"),
    );

    const agencyEvents = await history.listEvents(
      config.registry.id,
      "example-agency",
      {
        visibility: "public",
      },
    );
    const relationship = agencyEvents.find(
      (event) =>
        event.eventType === "relationship.added",
    );

    assert.ok(relationship);
    assert.equal(
      relationship.metadata.direction,
      "inbound",
    );
    assert.equal(
      relationship.metadata.otherRecordId,
      "example-report",
    );
  } finally {
    await pool.end();
  }
});

test("public history filters out non-public versions and events", async () => {
  const { pool, records, history } = await setup();

  try {
    await records.create({
      id: "private-item",
      registryId: config.registry.id,
      recordTypeId: "document",
      fields: {
        title: "Private item",
        summary: "Not for public history",
        document_type: "report",
        published_on: "2026-02-01",
        publisher: "example-agency",
      },
      status: "draft",
      visibility: "private",
      createdAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
    });

    const allVersions = await history.listVersions(
      config.registry.id,
      "private-item",
    );
    const publicVersions = await history.listVersions(
      config.registry.id,
      "private-item",
      {
        visibility: "public",
      },
    );
    const publicEvents = await history.listEvents(
      config.registry.id,
      "private-item",
      {
        visibility: "public",
      },
    );

    assert.equal(allVersions.length, 1);
    assert.equal(publicVersions.length, 0);
    assert.equal(publicEvents.length, 0);
  } finally {
    await pool.end();
  }
});

test("record deletion preserves immutable versions and deletion history", async () => {
  const { pool, records, history } = await setup();

  try {
    await records.create({
      id: "disposable-item",
      registryId: config.registry.id,
      recordTypeId: "document",
      fields: {
        title: "Disposable item",
        summary: "Used to verify deletion history.",
        document_type: "notice",
        published_on: "2026-03-01",
        publisher: "example-agency",
      },
      status: "published",
      visibility: "public",
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
      publishedAt: "2026-03-01T00:00:00.000Z",
    });

    assert.equal(
      await records.delete(
        config.registry.id,
        "disposable-item",
      ),
      true,
    );

    const current = await records.get(
      config.registry.id,
      "disposable-item",
    );
    const versions = await history.listVersions(
      config.registry.id,
      "disposable-item",
    );
    const events = await history.listEvents(
      config.registry.id,
      "disposable-item",
    );

    assert.equal(current, null);
    assert.equal(versions.length, 2);
    assert.equal(versions[0].operation, "deleted");
    assert.ok(
      events.some(
        (event) => event.eventType === "record.deleted",
      ),
    );
  } finally {
    await pool.end();
  }
});

test("database history captures optional actor and reason session context", async () => {
  const { pool, history } = await setup();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      `
        SELECT set_config(
          'civic_registry.actor_id',
          'actor-123',
          true
        )
      `,
    );
    await client.query(
      `
        SELECT set_config(
          'civic_registry.reason',
          'Corrected public summary.',
          true
        )
      `,
    );
    await client.query(
      `
        UPDATE civic_registry_records
        SET
          fields = jsonb_set(
            fields,
            '{summary}',
            to_jsonb('Corrected summary'::text)
          ),
          updated_at = '2026-04-01T00:00:00.000Z'
        WHERE registry_id = $1
          AND id = 'example-report'
      `,
      [config.registry.id],
    );
    await client.query("COMMIT");

    const versions = await history.listVersions(
      config.registry.id,
      "example-report",
    );
    const fieldEvent = (
      await history.listEvents(
        config.registry.id,
        "example-report",
      )
    ).find(
      (event) =>
        event.eventType === "record.fields_changed",
    );

    assert.equal(versions[0].actorId, "actor-123");
    assert.equal(
      versions[0].reason,
      "Corrected public summary.",
    );
    assert.equal(fieldEvent.actorId, "actor-123");
    assert.equal(
      fieldEvent.reason,
      "Corrected public summary.",
    );
  } finally {
    try {
      await client.query("ROLLBACK");
    } catch {}
    client.release();
    await pool.end();
  }
});


test("repeat seeding does not manufacture relationship or citation audit history", async () => {
  const { pool, history } = await setup();

  try {
    const before = await history.listEvents(
      config.registry.id,
      "example-report",
    );

    await seedRegistry(pool, config, seed);

    const after = await history.listEvents(
      config.registry.id,
      "example-report",
    );

    assert.equal(after.length, before.length);
    assert.deepEqual(
      after.map((event) => event.eventType),
      before.map((event) => event.eventType),
    );
  } finally {
    await pool.end();
  }
});
