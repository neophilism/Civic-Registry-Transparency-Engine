import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  PostgresSourceRefreshService,
} from "../packages/database/src/index.ts";

function job(overrides = {}) {
  return {
    id: "example-job",
    registryId: "example-registry",
    label: "Example refresh",
    adapterId: "example-adapter",
    profileId: "example-profile",
    enabled: true,
    intervalSeconds: 3600,
    staleAfterSeconds: 7200,
    failureBackoffBaseSeconds: 60,
    failureBackoffMaxSeconds: 3600,
    adapterOptions: {},
    emptyResultBehavior: "warning",
    rowCountDropWarningPercent: 50,
    nextRunAt: "2026-10-07T12:00:00.000Z",
    consecutiveFailures: 0,
    createdAt: "2026-10-07T10:00:00.000Z",
    updatedAt: "2026-10-07T10:00:00.000Z",
    ...overrides,
  };
}

test("source refresh health states are deterministic", () => {
  const service = new PostgresSourceRefreshService({});

  assert.equal(
    service.getHealth(
      job({ enabled: false }),
      "2026-10-07T13:00:00.000Z",
    ).status,
    "disabled",
  );

  assert.equal(
    service.getHealth(
      job(),
      "2026-10-07T13:00:00.000Z",
    ).status,
    "never_run",
  );

  assert.equal(
    service.getHealth(
      job({
        leaseToken: "lease",
        leaseExpiresAt: "2026-10-07T14:00:00.000Z",
      }),
      "2026-10-07T13:00:00.000Z",
    ).status,
    "running",
  );

  assert.equal(
    service.getHealth(
      job({
        lastStatus: "completed",
        lastCompletedAt: "2026-10-07T12:30:00.000Z",
        lastWarningCount: 0,
      }),
      "2026-10-07T13:00:00.000Z",
    ).status,
    "healthy",
  );

  assert.equal(
    service.getHealth(
      job({
        lastStatus: "completed_with_warnings",
        lastCompletedAt: "2026-10-07T12:30:00.000Z",
        lastWarningCount: 1,
      }),
      "2026-10-07T13:00:00.000Z",
    ).status,
    "warning",
  );

  assert.equal(
    service.getHealth(
      job({
        lastStatus: "failed",
        lastCompletedAt: "2026-10-07T12:30:00.000Z",
        lastError: "Source failed.",
      }),
      "2026-10-07T13:00:00.000Z",
    ).status,
    "failing",
  );

  assert.equal(
    service.getHealth(
      job({
        lastStatus: "completed",
        lastCompletedAt: "2026-10-07T10:00:00.000Z",
      }),
      "2026-10-07T13:00:01.000Z",
    ).status,
    "stale",
  );
});

test("source refresh migration and admin UI expose leases, health, and worker-only execution", () => {
  const migration = fs.readFileSync(
    "packages/database/migrations/0011_source_refresh_orchestration.sql",
    "utf8",
  );
  const service = fs.readFileSync(
    "packages/database/src/source-refresh.ts",
    "utf8",
  );
  const page = fs.readFileSync(
    "apps/web/app/admin/registries/[registryId]/source-refresh/page.tsx",
    "utf8",
  );

  assert.match(
    migration,
    /civic_registry_source_refresh_jobs/,
  );
  assert.match(
    migration,
    /civic_registry_source_refresh_runs/,
  );
  assert.match(service, /FOR UPDATE SKIP LOCKED/);
  assert.match(service, /failureBackoffBaseSeconds/);
  assert.match(page, /Queue now/);
  assert.match(page, /never fetches remote source sites/i);
  assert.doesNotMatch(page, /runSourceAdapter/);
});
