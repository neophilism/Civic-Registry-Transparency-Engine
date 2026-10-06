import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  notificationEventTitle,
  notificationMatchesSubscription,
} from "../packages/core/src/index.ts";
import {
  parseRegistryConfig,
  validateRegistryConfig,
} from "../packages/config/src/index.ts";

const configSource = fs.readFileSync(
  "examples/generic-registry/registry.yaml",
  "utf8",
);
const config = parseRegistryConfig(configSource, {
  sourceName:
    "examples/generic-registry/registry.yaml",
});

test("notification matching enforces public scope and generic filters", () => {
  const subscription = {
    id: "sub-1",
    registryId: config.registry.id,
    scope: "public",
    channel: "internal",
    target: { recipientId: "operator" },
    eventTypes: ["record.matching_created"],
    filters: {
      recordTypeIds: ["document"],
      tags: ["priority"],
    },
    enabled: true,
    createdAt: "2026-10-06T00:00:00.000Z",
    updatedAt: "2026-10-06T00:00:00.000Z",
  };

  const event = {
    id: "event-1",
    registryId: config.registry.id,
    eventType: "record.matching_created",
    subjectType: "record",
    subjectId: "record-1",
    visibility: "public",
    occurredAt: "2026-10-06T01:00:00.000Z",
    dedupeKey: "record-1",
    payload: {
      recordTypeId: "document",
      status: "published",
      tags: ["priority"],
    },
  };

  assert.equal(
    notificationMatchesSubscription(
      event,
      subscription,
    ),
    true,
  );
  assert.equal(
    notificationMatchesSubscription(
      {
        ...event,
        visibility: "private",
      },
      subscription,
    ),
    false,
  );
  assert.equal(
    notificationMatchesSubscription(
      {
        ...event,
        payload: {
          ...event.payload,
          tags: ["other"],
        },
      },
      subscription,
    ),
    false,
  );
  assert.equal(
    notificationEventTitle(
      "deadline.missed",
    ),
    "Deadline missed",
  );
});

test("notification configuration validates supported channels and limits", () => {
  assert.equal(
    validateRegistryConfig(config).length,
    0,
  );

  const invalid = structuredClone(config);
  invalid.notifications = {
    enabled: true,
    allowedChannels: ["carrier-pigeon"],
    eventTypes: ["record.published"],
    deadlineApproachingDays: 0,
  };

  const issues = validateRegistryConfig(invalid);

  assert.ok(
    issues.some(
      (issue) =>
        issue.path ===
        "notifications.allowedChannels",
    ),
  );
  assert.ok(
    issues.some(
      (issue) =>
        issue.path ===
        "notifications.deadlineApproachingDays",
    ),
  );
});

test("delivery implementation includes signed webhooks, SSRF checks, retries, and explicit relay configuration", () => {
  const source = fs.readFileSync(
    "packages/database/src/notifications.ts",
    "utf8",
  );

  assert.match(
    source,
    /x-civic-registry-signature/,
  );
  assert.match(
    source,
    /unsafe_webhook_destination/,
  );
  assert.match(
    source,
    /FOR UPDATE SKIP LOCKED/,
  );
  assert.match(
    source,
    /CIVIC_REGISTRY_EMAIL_RELAY_URL/,
  );
  assert.match(
    source,
    /maxDeliveryAttempts/,
  );
});
