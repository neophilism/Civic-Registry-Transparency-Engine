import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseRegistryConfig,
} from "../packages/config/src/index.ts";
import {
  createDatabasePool,
  PostgresPublicationLifecycleService,
  PostgresRecordRepository,
  PostgresRegistryConfigRepository,
  PostgresRelationshipRepository,
  runMigrations,
} from "../packages/database/src/index.ts";
import {
  getDatabasePool,
} from "../apps/web/lib/database.ts";
import {
  getPublicHistory,
  getPublicRecord,
  getPublicRegistry,
  listPublicRecords,
  listPublicRelationships,
  searchPublicRecords,
} from "../apps/web/lib/public-registry.ts";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required for public lifecycle integration tests.",
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

function documentRecord(id, status) {
  return {
    id,
    registryId: config.registry.id,
    recordTypeId: "document",
    fields: {
      title: "Public lifecycle " + id,
      summary: "Visibility boundary test.",
    },
    status,
    visibility: "public",
    tags: [],
    externalIdentifiers: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    publishedAt:
      status === "published"
        ? "2026-01-01T00:00:00.000Z"
        : undefined,
  };
}

test("public surfaces require both public visibility and a publicly visible lifecycle state", async () => {
  const pool = createDatabasePool({
    connectionString: databaseUrl,
    applicationName:
      "civic-registry-public-lifecycle-tests",
  });

  try {
    await runMigrations(pool);
    await pool.query(
      "TRUNCATE civic_registry_configurations CASCADE",
    );

    const configs =
      new PostgresRegistryConfigRepository(pool);
    const records =
      new PostgresRecordRepository(pool, configs);
    const relationships =
      new PostgresRelationshipRepository(
        pool,
        configs,
        records,
      );
    const lifecycle =
      new PostgresPublicationLifecycleService(pool);

    await configs.upsert(config);

    const draft = await records.create(
      documentRecord("draft-doc", "draft"),
    );
    const published = await records.create(
      documentRecord(
        "published-doc",
        "published",
      ),
      { bootstrapLifecycle: true },
    );
    const historyRecord = await records.create(
      documentRecord("history-doc", "draft"),
    );
    const draftOrganization = await records.create({
      id: "draft-org",
      registryId: config.registry.id,
      recordTypeId: "organization",
      fields: {
        name: "Draft organization",
      },
      status: "draft",
      visibility: "public",
      tags: [],
      externalIdentifiers: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    await relationships.create({
      id: "hidden-related-record",
      registryId: config.registry.id,
      relationshipTypeId: "published-by",
      fromRecordId: published.id,
      toRecordId: draftOrganization.id,
      createdAt: "2026-01-01T00:10:00.000Z",
      metadata: {},
    });

    const registry = await getPublicRegistry(
      config.registry.id,
    );

    assert.ok(registry);

    assert.equal(
      await getPublicRecord(
        config.registry.id,
        draft.id,
      ),
      null,
    );
    assert.equal(
      (
        await getPublicRecord(
          config.registry.id,
          published.id,
        )
      )?.id,
      published.id,
    );

    const listed = await listPublicRecords(
      config.registry.id,
      "document",
    );

    assert.deepEqual(
      listed.map((record) => record.id),
      ["published-doc"],
    );

    const searched = await searchPublicRecords(
      registry.config,
      {
        pageSize: 100,
      },
    );

    assert.deepEqual(
      searched.hits.map((hit) => hit.record.id),
      ["published-doc"],
    );

    const draftSearch =
      await searchPublicRecords(
        registry.config,
        {
          statuses: ["draft"],
          pageSize: 100,
        },
      );

    assert.equal(draftSearch.total, 0);

    const related =
      await listPublicRelationships(
        registry.config,
        published,
      );

    assert.equal(related.relationships.length, 0);

    await lifecycle.requestTransition({
      registryId: config.registry.id,
      recordId: historyRecord.id,
      toStatusId: "under_review",
      context: {
        actorId: "editor-history",
        roles: ["editor"],
      },
      now: "2026-01-01T01:00:00.000Z",
    });

    const approvalRequest =
      await lifecycle.requestTransition({
        registryId: config.registry.id,
        recordId: historyRecord.id,
        toStatusId: "approved",
        context: {
          actorId: "reviewer-history",
          roles: ["reviewer"],
        },
        now: "2026-01-01T02:00:00.000Z",
      });

    assert.equal(
      approvalRequest.kind,
      "pending_approval",
    );

    await lifecycle.decideTransition({
      registryId: config.registry.id,
      requestId: approvalRequest.request.id,
      decision: "approved",
      actorId: "publisher-history",
      actorRoles: ["publisher"],
      now: "2026-01-01T03:00:00.000Z",
    });

    const publishResult =
      await lifecycle.requestTransition({
        registryId: config.registry.id,
        recordId: historyRecord.id,
        toStatusId: "published",
        context: {
          actorId: "publisher-history",
          roles: ["publisher"],
        },
        now: "2026-01-02T00:00:00.000Z",
      });

    assert.equal(publishResult.kind, "executed");

    const publicHistoryRecord =
      await getPublicRecord(
        config.registry.id,
        historyRecord.id,
      );

    assert.ok(publicHistoryRecord);

    const history = await getPublicHistory(
      registry.config,
      publicHistoryRecord,
    );

    assert.equal(history.revisions.length, 1);
    assert.equal(
      history.revisions[0].record.status,
      "published",
    );
    assert.ok(
      !history.events.some(
        (event) =>
          event.eventType === "record.created",
      ),
    );
    assert.ok(
      history.events.some(
        (event) =>
          event.eventType === "record.published",
      ),
    );
  } finally {
    await pool.end();
    await getDatabasePool().end();
  }
});
