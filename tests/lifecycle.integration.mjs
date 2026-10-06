import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseRegistryConfig,
} from "../packages/config/src/index.ts";
import {
  createDatabasePool,
  PersistenceConflictError,
  PostgresPublicationLifecycleService,
  PostgresRecordHistoryRepository,
  PostgresRecordRepository,
  PostgresRegistryConfigRepository,
  PublicationLifecycleError,
  runMigrations,
} from "../packages/database/src/index.ts";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required for lifecycle integration tests.",
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

function record(id, status = "draft") {
  return {
    id,
    registryId: config.registry.id,
    recordTypeId: "document",
    fields: {
      title: "Lifecycle " + id,
      summary: "Lifecycle integration test record.",
    },
    status,
    visibility: "public",
    tags: ["lifecycle"],
    externalIdentifiers: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

async function setup() {
  const pool = createDatabasePool({
    connectionString: databaseUrl,
    applicationName:
      "civic-registry-lifecycle-tests",
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
    records: new PostgresRecordRepository(
      pool,
      configs,
    ),
    lifecycle:
      new PostgresPublicationLifecycleService(pool),
    history:
      new PostgresRecordHistoryRepository(pool),
  };
}

async function advanceToApproved({
  records,
  lifecycle,
  id,
}) {
  await records.create(record(id));

  const submitted = await lifecycle.requestTransition({
    registryId: config.registry.id,
    recordId: id,
    toStatusId: "under_review",
    context: {
      actorId: "editor-1",
      roles: ["editor"],
      reason: "Ready for review.",
    },
    now: "2026-01-01T01:00:00.000Z",
  });

  assert.equal(submitted.kind, "executed");
  assert.equal(submitted.record.status, "under_review");

  const requested = await lifecycle.requestTransition({
    registryId: config.registry.id,
    recordId: id,
    toStatusId: "approved",
    context: {
      actorId: "reviewer-1",
      roles: ["reviewer"],
      reason: "Request approval.",
    },
    now: "2026-01-01T02:00:00.000Z",
  });

  assert.equal(requested.kind, "pending_approval");

  return requested.request;
}

test("repository validates lifecycle states and blocks direct status changes", async () => {
  const { pool, records } = await setup();

  try {
    const draft = await records.create(
      record("guarded"),
    );

    await assert.rejects(
      () =>
        records.create(
          record("bad-status", "invented"),
        ),
      PersistenceConflictError,
    );

    await assert.rejects(
      () =>
        records.create(
          record(
            "published-direct",
            "published",
          ),
        ),
      PersistenceConflictError,
    );

    await assert.rejects(
      () =>
        pool.query(
          "UPDATE civic_registry_records SET status = 'under_review' WHERE registry_id = $1 AND id = 'guarded'",
          [config.registry.id],
        ),
      /publication lifecycle service/i,
    );

    await assert.rejects(
      () =>
        records.update({
          ...draft,
          status: "under_review",
          updatedAt:
            "2026-01-01T01:00:00.000Z",
        }),
      PersistenceConflictError,
    );
  } finally {
    await pool.end();
  }
});

test("direct transitions enforce configured requester roles", async () => {
  const { pool, records, lifecycle } =
    await setup();

  try {
    await records.create(record("roles"));

    await assert.rejects(
      () =>
        lifecycle.requestTransition({
          registryId: config.registry.id,
          recordId: "roles",
          toStatusId: "under_review",
          context: {
            actorId: "viewer-1",
            roles: ["viewer"],
          },
          now: "2026-01-01T01:00:00.000Z",
        }),
      (error) => {
        assert.ok(
          error instanceof PublicationLifecycleError,
        );
        assert.equal(error.code, "forbidden");
        return true;
      },
    );

    const result =
      await lifecycle.requestTransition({
        registryId: config.registry.id,
        recordId: "roles",
        toStatusId: "under_review",
        context: {
          actorId: "editor-1",
          roles: ["editor"],
        },
        now: "2026-01-01T01:00:00.000Z",
      });

    assert.equal(result.kind, "executed");
    assert.equal(
      (await records.get(
        config.registry.id,
        "roles",
      ))?.status,
      "under_review",
    );
  } finally {
    await pool.end();
  }
});

test("approval-gated transitions prohibit self approval and execute after threshold", async () => {
  const {
    pool,
    records,
    lifecycle,
  } = await setup();

  try {
    const request = await advanceToApproved({
      records,
      lifecycle,
      id: "approval",
    });

    await assert.rejects(
      () =>
        lifecycle.decideTransition({
          registryId: config.registry.id,
          requestId: request.id,
          decision: "approved",
          actorId: "reviewer-1",
          actorRoles: ["reviewer"],
          now: "2026-01-01T03:00:00.000Z",
        }),
      (error) => {
        assert.ok(
          error instanceof PublicationLifecycleError,
        );
        assert.equal(
          error.code,
          "requester_cannot_approve",
        );
        return true;
      },
    );

    const decided =
      await lifecycle.decideTransition({
        registryId: config.registry.id,
        requestId: request.id,
        decision: "approved",
        actorId: "publisher-1",
        actorRoles: ["publisher"],
        note: "Approved for publication.",
        now: "2026-01-01T03:00:00.000Z",
      });

    assert.equal(decided.approvals, 1);
    assert.equal(
      decided.request.status,
      "executed",
    );
    assert.equal(
      decided.record?.status,
      "approved",
    );

    const decisions =
      await lifecycle.listTransitionDecisions(
        config.registry.id,
        request.id,
      );

    assert.equal(decisions.length, 1);
    assert.equal(
      decisions[0].actorId,
      "publisher-1",
    );
  } finally {
    await pool.end();
  }
});

test("scheduled publication executes due work and preserves original publication time on republish", async () => {
  const {
    pool,
    records,
    lifecycle,
    history,
  } = await setup();

  try {
    const request = await advanceToApproved({
      records,
      lifecycle,
      id: "scheduled",
    });

    await lifecycle.decideTransition({
      registryId: config.registry.id,
      requestId: request.id,
      decision: "approved",
      actorId: "publisher-1",
      actorRoles: ["publisher"],
      now: "2026-01-01T03:00:00.000Z",
    });

    await assert.rejects(
      () =>
        lifecycle.schedulePublication({
          registryId: config.registry.id,
          recordId: "scheduled",
          scheduledFor:
            "2026-01-02T00:00:00.000Z",
          context: {
            actorId: "editor-1",
            roles: ["editor"],
          },
          now: "2026-01-01T04:00:00.000Z",
        }),
      (error) => {
        assert.ok(
          error instanceof PublicationLifecycleError,
        );
        assert.equal(error.code, "forbidden");
        return true;
      },
    );

    const schedule =
      await lifecycle.schedulePublication({
        registryId: config.registry.id,
        recordId: "scheduled",
        scheduledFor:
          "2026-01-02T00:00:00.000Z",
        context: {
          actorId: "publisher-1",
          roles: ["publisher"],
          reason: "Publish tomorrow.",
        },
        now: "2026-01-01T04:00:00.000Z",
      });

    const early =
      await lifecycle.processDueSchedules({
        now: "2026-01-01T23:59:00.000Z",
      });

    assert.equal(early.examined, 0);

    const due =
      await lifecycle.processDueSchedules({
        now: "2026-01-02T00:00:00.000Z",
      });

    assert.equal(due.executed, 1);

    const published = await records.get(
      config.registry.id,
      "scheduled",
    );

    assert.equal(published?.status, "published");
    assert.equal(
      published?.publishedAt,
      "2026-01-02T00:00:00.000Z",
    );

    assert.equal(
      (
        await lifecycle.getSchedule(
          config.registry.id,
          schedule.id,
        )
      )?.status,
      "executed",
    );

    const publicEvents = await history.listEvents(
      config.registry.id,
      "scheduled",
      {
        visibility: "public",
      },
    );

    assert.ok(
      publicEvents.some(
        (event) =>
          event.eventType === "record.published",
      ),
    );

    const withdrawn =
      await lifecycle.requestTransition({
        registryId: config.registry.id,
        recordId: "scheduled",
        toStatusId: "withdrawn",
        context: {
          actorId: "publisher-1",
          roles: ["publisher"],
        },
        now: "2026-01-03T00:00:00.000Z",
      });

    assert.equal(withdrawn.kind, "executed");
    assert.equal(
      withdrawn.record.publishedAt,
      "2026-01-02T00:00:00.000Z",
    );

    const republished =
      await lifecycle.requestTransition({
        registryId: config.registry.id,
        recordId: "scheduled",
        toStatusId: "published",
        context: {
          actorId: "publisher-1",
          roles: ["publisher"],
        },
        now: "2026-01-04T00:00:00.000Z",
      });

    assert.equal(republished.kind, "executed");
    assert.equal(
      republished.record.publishedAt,
      "2026-01-02T00:00:00.000Z",
    );
  } finally {
    await pool.end();
  }
});

test("due processor fails stale schedules instead of forcing publication", async () => {
  const {
    pool,
    records,
    lifecycle,
  } = await setup();

  try {
    const request = await advanceToApproved({
      records,
      lifecycle,
      id: "stale",
    });

    await lifecycle.decideTransition({
      registryId: config.registry.id,
      requestId: request.id,
      decision: "approved",
      actorId: "publisher-1",
      actorRoles: ["publisher"],
      now: "2026-01-01T03:00:00.000Z",
    });

    const schedule =
      await lifecycle.schedulePublication({
        registryId: config.registry.id,
        recordId: "stale",
        scheduledFor:
          "2026-01-02T00:00:00.000Z",
        context: {
          actorId: "publisher-1",
          roles: ["publisher"],
        },
        now: "2026-01-01T04:00:00.000Z",
      });

    const privileged = await pool.connect();

    try {
      await privileged.query("BEGIN");
      await privileged.query(
        "SELECT set_config('civic_registry.lifecycle_transition', 'allowed', true)",
      );
      await privileged.query(
        "UPDATE civic_registry_records SET status = 'published', updated_at = '2026-01-01T12:00:00.000Z' WHERE registry_id = $1 AND id = 'stale'",
        [config.registry.id],
      );
      await privileged.query("COMMIT");
    } catch (error) {
      await privileged.query("ROLLBACK");
      throw error;
    } finally {
      privileged.release();
    }

    const result =
      await lifecycle.processDueSchedules({
        now: "2026-01-02T00:00:00.000Z",
      });

    assert.equal(result.executed, 0);
    assert.equal(result.failed, 1);

    const staleSchedule =
      await lifecycle.getSchedule(
        config.registry.id,
        schedule.id,
      );

    assert.equal(staleSchedule?.status, "failed");
    assert.match(
      staleSchedule?.failureReason ?? "",
      /status changed/i,
    );
    assert.equal(
      (
        await records.get(
          config.registry.id,
          "stale",
        )
      )?.status,
      "published",
    );
  } finally {
    await pool.end();
  }
});
