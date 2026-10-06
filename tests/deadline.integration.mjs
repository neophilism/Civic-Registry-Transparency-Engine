import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseRegistryConfig,
} from "../packages/config/src/index.ts";
import {
  createDatabasePool,
  DeadlineEngineError,
  PostgresDeadlineService,
  PostgresPublicationLifecycleService,
  PostgresRecordHistoryRepository,
  PostgresRecordRepository,
  PostgresRegistryConfigRepository,
  runMigrations,
} from "../packages/database/src/index.ts";
import {
  getDatabasePool,
} from "../apps/web/lib/database.ts";
import {
  getPublicDeadlines,
  getPublicRecordView,
  getPublicRegistry,
} from "../apps/web/lib/public-registry.ts";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required for deadline integration tests.",
  );
}

const baseConfig = parseRegistryConfig(
  await readFile(
    "examples/generic-registry/registry.yaml",
    "utf8",
  ),
  {
    sourceName:
      "examples/generic-registry/registry.yaml",
  },
);

const config = structuredClone(baseConfig);
config.deadlines.definitions.push({
  id: "archive_followup",
  label: "Archive follow-up",
  recordTypeIds: ["document"],
  anchor: {
    kind: "statusEntered",
    statusId: "archived",
  },
  offset: {
    value: 24,
    unit: "hours",
  },
  publiclyVisible: false,
});

test.after(async () => {
  await getDatabasePool().end();
});

function record(id, status = "published") {
  return {
    id,
    registryId: config.registry.id,
    recordTypeId: "document",
    fields: {
      title: "Deadline " + id,
      summary: "Deadline integration test.",
      document_type: "report",
      published_on: "2026-01-01",
    },
    status,
    visibility: "public",
    tags: ["deadline"],
    externalIdentifiers: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    publishedAt:
      status === "published"
        ? "2026-01-01T00:00:00.000Z"
        : undefined,
  };
}

async function setup() {
  const pool = createDatabasePool({
    connectionString: databaseUrl,
    applicationName:
      "civic-registry-deadline-tests",
  });

  await runMigrations(pool);
  await pool.query(
    "TRUNCATE civic_registry_configurations CASCADE",
  );

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
  const lifecycle =
    new PostgresPublicationLifecycleService(
      pool,
      deadlines,
    );
  const history =
    new PostgresRecordHistoryRepository(pool);

  await configs.upsert(config);

  return {
    pool,
    configs,
    deadlines,
    records,
    lifecycle,
    history,
  };
}

test("record creation materializes configured field deadlines and public audit history", async () => {
  const {
    pool,
    records,
    deadlines,
    history,
  } = await setup();

  try {
    await records.create(
      record("materialized"),
      {
        bootstrapLifecycle: true,
      },
    );

    const instances =
      await deadlines.listForRecord(
        config.registry.id,
        "materialized",
      );

    const review = instances.find(
      (deadline) =>
        deadline.deadlineTypeId ===
        "review_due",
    );

    assert.ok(review);
    assert.equal(
      review.anchorAt,
      "2026-01-01T23:59:59.999Z",
    );
    assert.equal(
      review.dueAt,
      "2026-01-29T23:59:59.999Z",
    );
    assert.equal(review.state, "open");

    const publicEvents =
      await history.listEvents(
        config.registry.id,
        "materialized",
        {
          visibility: "public",
        },
      );

    assert.ok(
      publicEvents.some(
        (event) =>
          event.eventType ===
          "deadline.created",
      ),
    );
  } finally {
    await pool.end();
  }
});

test("lifecycle transitions automatically pause, resume, toll, complete, and create status-entry deadlines", async () => {
  const {
    pool,
    records,
    deadlines,
    lifecycle,
  } = await setup();

  try {
    await records.create(
      record("lifecycle"),
      {
        bootstrapLifecycle: true,
      },
    );

    const before = (
      await deadlines.listForRecord(
        config.registry.id,
        "lifecycle",
      )
    ).find(
      (deadline) =>
        deadline.deadlineTypeId ===
        "review_due",
    );

    assert.ok(before);
    assert.equal(
      before.dueAt,
      "2026-01-29T23:59:59.999Z",
    );

    await lifecycle.requestTransition({
      registryId: config.registry.id,
      recordId: "lifecycle",
      toStatusId: "withdrawn",
      context: {
        actorId: "publisher-1",
        roles: ["publisher"],
      },
      now: "2026-01-10T12:00:00.000Z",
    });

    const paused = (
      await deadlines.listForRecord(
        config.registry.id,
        "lifecycle",
      )
    ).find(
      (deadline) =>
        deadline.deadlineTypeId ===
        "review_due",
    );

    assert.equal(paused?.state, "paused");
    assert.equal(
      paused?.pausedAt,
      "2026-01-10T12:00:00.000Z",
    );

    await lifecycle.requestTransition({
      registryId: config.registry.id,
      recordId: "lifecycle",
      toStatusId: "published",
      context: {
        actorId: "publisher-1",
        roles: ["publisher"],
      },
      now: "2026-01-12T12:00:00.000Z",
    });

    const resumed = (
      await deadlines.listForRecord(
        config.registry.id,
        "lifecycle",
      )
    ).find(
      (deadline) =>
        deadline.deadlineTypeId ===
        "review_due",
    );

    assert.equal(resumed?.state, "open");
    assert.equal(
      resumed?.totalPausedSeconds,
      172800,
    );
    assert.equal(
      resumed?.dueAt,
      "2026-01-31T23:59:59.999Z",
    );

    await lifecycle.requestTransition({
      registryId: config.registry.id,
      recordId: "lifecycle",
      toStatusId: "archived",
      context: {
        actorId: "publisher-1",
        roles: ["publisher"],
      },
      now: "2026-01-13T12:00:00.000Z",
    });

    const after =
      await deadlines.listForRecord(
        config.registry.id,
        "lifecycle",
      );
    const completed = after.find(
      (deadline) =>
        deadline.deadlineTypeId ===
        "review_due",
    );
    const archive = after.find(
      (deadline) =>
        deadline.deadlineTypeId ===
        "archive_followup",
    );

    assert.equal(
      completed?.state,
      "completed",
    );
    assert.equal(
      completed?.completedAt,
      "2026-01-13T12:00:00.000Z",
    );
    assert.ok(archive);
    assert.equal(
      archive.anchorAt,
      "2026-01-13T12:00:00.000Z",
    );
    assert.equal(
      archive.dueAt,
      "2026-01-14T12:00:00.000Z",
    );
  } finally {
    await pool.end();
  }
});

test("manual deadline instances support keyed creation and explicit pause/resume", async () => {
  const {
    pool,
    records,
    deadlines,
  } = await setup();

  try {
    await records.create(
      record("manual"),
      {
        bootstrapLifecycle: true,
      },
    );

    const manual = await deadlines.createManual({
      registryId: config.registry.id,
      recordId: "manual",
      deadlineTypeId: "manual_response",
      instanceKey: "request-17",
      anchorAt: "2026-01-02",
      now: "2026-01-02T10:00:00.000Z",
      context: {
        actorId: "clerk-1",
        reason: "Response request received.",
      },
      metadata: {
        requestNumber: "17",
      },
    });

    assert.equal(
      manual.instanceKey,
      "request-17",
    );
    assert.equal(
      manual.anchorAt,
      "2026-01-02T23:59:59.999Z",
    );
    assert.equal(
      manual.dueAt,
      "2026-01-16T23:59:59.999Z",
    );

    await deadlines.pause(
      config.registry.id,
      manual.id,
      {
        now: "2026-01-05T12:00:00.000Z",
      },
    );
    const resumed = await deadlines.resume(
      config.registry.id,
      manual.id,
      {
        now: "2026-01-06T12:00:00.000Z",
      },
    );

    assert.equal(resumed.state, "open");
    assert.equal(
      resumed.totalPausedSeconds,
      86400,
    );
    assert.equal(
      resumed.dueAt,
      "2026-01-17T23:59:59.999Z",
    );

    await assert.rejects(
      () =>
        deadlines.createManual({
          registryId: config.registry.id,
          recordId: "manual",
          deadlineTypeId: "review_due",
          anchorAt: "2026-01-02",
        }),
      (error) => {
        assert.ok(
          error instanceof DeadlineEngineError,
        );
        assert.equal(
          error.code,
          "deadline_not_manual",
        );
        return true;
      },
    );
  } finally {
    await pool.end();
  }
});

test("public deadline views expose only explicitly public definitions", async () => {
  const {
    pool,
    records,
    deadlines,
  } = await setup();

  try {
    await records.create(
      record("public"),
      {
        bootstrapLifecycle: true,
      },
    );

    await deadlines.createManual({
      registryId: config.registry.id,
      recordId: "public",
      deadlineTypeId: "manual_response",
      instanceKey: "private-deadline",
      anchorAt: "2026-01-02",
      now: "2026-01-02T10:00:00.000Z",
    });

    const registry = await getPublicRegistry(
      config.registry.id,
    );
    const recordView = await getPublicRecordView(
      config.registry.id,
      "public",
    );

    assert.ok(registry);
    assert.ok(recordView);

    const publicDeadlines =
      await getPublicDeadlines(
        registry.config,
        recordView.record,
        "2026-01-20T12:00:00.000Z",
      );

    assert.deepEqual(
      publicDeadlines.map(
        (deadline) => deadline.deadlineTypeId,
      ),
      ["review_due"],
    );
    assert.equal(
      publicDeadlines[0].urgency,
      "due_soon",
    );
  } finally {
    await pool.end();
  }
});
