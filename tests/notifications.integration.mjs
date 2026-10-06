import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseRegistryConfig,
} from "../packages/config/src/index.ts";
import {
  createDatabasePool,
  PostgresNotificationService,
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

test("public notification subscriptions cannot receive private record events", async () => {
  const pool = createDatabasePool({
    connectionString: databaseUrl,
    applicationName:
      "civic-registry-notification-integration-tests",
  });

  try {
    await runMigrations(pool);
    await pool.query(
      "TRUNCATE civic_registry_configurations CASCADE",
    );

    const configs =
      new PostgresRegistryConfigRepository(pool);
    await configs.upsert(config);

    const notifications =
      new PostgresNotificationService(pool);
    await notifications.createSubscription({
      registryId: config.registry.id,
      scope: "public",
      channel: "internal",
      target: {
        recipientId: "operator@example.org",
      },
      eventTypes: ["record.matching_created"],
      filters: {
        recordTypeIds: ["document"],
      },
      actorId: "operator@example.org",
      now: "2026-10-06T00:00:00.000Z",
    });

    const records = new PostgresRecordRepository(
      pool,
      configs,
    );

    await records.create(
      {
        id: "public-notification-record",
        registryId: config.registry.id,
        recordTypeId: "document",
        fields: {
          title: "Public notice",
          document_type: "notice",
        },
        status: "published",
        visibility: "public",
        externalIdentifiers: [],
        tags: [],
        createdAt: "2026-10-06T01:00:00.000Z",
        updatedAt: "2026-10-06T01:00:00.000Z",
        publishedAt: "2026-10-06T01:00:00.000Z",
      },
      {
        bootstrapLifecycle: true,
      },
    );

    await records.create(
      {
        id: "private-notification-record",
        registryId: config.registry.id,
        recordTypeId: "document",
        fields: {
          title: "Private notice",
          document_type: "notice",
        },
        status: "published",
        visibility: "private",
        externalIdentifiers: [],
        tags: [],
        createdAt: "2026-10-06T01:05:00.000Z",
        updatedAt: "2026-10-06T01:05:00.000Z",
        publishedAt: "2026-10-06T01:05:00.000Z",
      },
      {
        bootstrapLifecycle: true,
      },
    );

    const result = await notifications.run(
      config.registry.id,
      {
        now: "2026-10-06T02:00:00.000Z",
      },
    );

    assert.equal(result.materialized, 1);
    assert.equal(result.dispatched, 1);
    assert.equal(result.failed, 0);

    const inbox =
      await notifications.listInternalNotifications(
        config.registry.id,
        "operator@example.org",
      );

    assert.equal(inbox.length, 1);

    const events =
      await notifications.listEvents(
        config.registry.id,
        { limit: 50 },
      );
    const publicCreated = events.filter(
      (event) =>
        event.eventType ===
          "record.matching_created" &&
        event.visibility === "public",
    );
    const privateCreated = events.filter(
      (event) =>
        event.eventType ===
          "record.matching_created" &&
        event.visibility === "private",
    );

    assert.ok(
      publicCreated.some(
        (event) =>
          event.subjectId ===
          "public-notification-record",
      ),
    );
    assert.ok(
      privateCreated.some(
        (event) =>
          event.subjectId ===
          "private-notification-record",
      ),
    );
  } finally {
    await pool.end();
  }
});
