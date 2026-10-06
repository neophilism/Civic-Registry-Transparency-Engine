import assert from "node:assert/strict";
import test from "node:test";

import {
  compileRegistryConfig,
  validateRegistryConfig,
} from "../packages/config/src/index.ts";

function baseConfig() {
  return {
    schemaVersion: 1,
    registry: {
      id: "lifecycle-test",
      name: "Lifecycle Test",
      recordTypes: [
        {
          id: "item",
          name: "Item",
          pluralName: "Items",
          titleFieldId: "name",
          fields: [
            {
              id: "name",
              label: "Name",
              type: "text",
              required: true,
            },
          ],
        },
      ],
    },
    publicationLifecycle: {
      initialStatusId: "draft",
      statuses: [
        {
          id: "draft",
          label: "Draft",
        },
        {
          id: "approved",
          label: "Approved",
        },
        {
          id: "published",
          label: "Published",
          publiclyVisible: true,
          marksPublished: true,
        },
        {
          id: "archived",
          label: "Archived",
          publiclyVisible: true,
          terminal: true,
        },
      ],
      transitions: [
        {
          fromStatusId: "draft",
          toStatusId: "approved",
          allowedRoles: ["editor"],
          approval: {
            approverRoles: ["reviewer"],
            minApprovals: 1,
          },
        },
        {
          fromStatusId: "approved",
          toStatusId: "published",
          allowedRoles: ["publisher"],
        },
        {
          fromStatusId: "published",
          toStatusId: "archived",
          allowedRoles: ["publisher"],
        },
      ],
      scheduledPublication: {
        enabled: true,
        fromStatusIds: ["approved"],
        targetStatusId: "published",
        allowedRoles: ["publisher"],
      },
    },
  };
}

test("compiles lifecycle statuses, transitions, and public states", () => {
  const compiled = compileRegistryConfig(baseConfig());
  const lifecycle = compiled.publicationLifecycle;

  assert.ok(lifecycle);
  assert.equal(
    lifecycle.getStatus("published").label,
    "Published",
  );
  assert.equal(
    lifecycle.isPublicStatus("draft"),
    false,
  );
  assert.equal(
    lifecycle.isPublicStatus("published"),
    true,
  );
  assert.equal(
    lifecycle.getTransition("approved", "published")
      ?.allowedRoles?.[0],
    "publisher",
  );
  assert.deepEqual(
    [...lifecycle.publicStatusIds],
    ["published", "archived"],
  );
});

test("rejects publication-marking states that are not public", () => {
  const invalid = baseConfig();
  invalid.publicationLifecycle.statuses[2] = {
    id: "published",
    label: "Published",
    marksPublished: true,
  };

  const issues = validateRegistryConfig(invalid);

  assert.ok(
    issues.some(
      (issue) =>
        issue.code === "published_status_not_public",
    ),
  );
});

test("rejects outgoing transitions from terminal statuses", () => {
  const invalid = baseConfig();
  invalid.publicationLifecycle.transitions.push({
    fromStatusId: "archived",
    toStatusId: "published",
    allowedRoles: ["publisher"],
  });

  const issues = validateRegistryConfig(invalid);

  assert.ok(
    issues.some(
      (issue) =>
        issue.code === "terminal_status_transition",
    ),
  );
});

test("scheduled publication requires a direct non-approval transition", () => {
  const missing = baseConfig();
  missing.publicationLifecycle.transitions =
    missing.publicationLifecycle.transitions.filter(
      (transition) =>
        !(
          transition.fromStatusId === "approved" &&
          transition.toStatusId === "published"
        ),
    );

  const missingIssues =
    validateRegistryConfig(missing);

  assert.ok(
    missingIssues.some(
      (issue) =>
        issue.code === "missing_schedule_transition",
    ),
  );

  const gated = baseConfig();
  gated.publicationLifecycle.transitions[1] = {
    ...gated.publicationLifecycle.transitions[1],
    approval: {
      approverRoles: ["publisher"],
      minApprovals: 1,
    },
  };

  const gatedIssues = validateRegistryConfig(gated);

  assert.ok(
    gatedIssues.some(
      (issue) =>
        issue.code ===
        "approval_gated_schedule_transition",
    ),
  );
});

test("approval rules require at least one approver role", () => {
  const invalid = baseConfig();
  invalid.publicationLifecycle.transitions[0] = {
    ...invalid.publicationLifecycle.transitions[0],
    approval: {
      approverRoles: [],
      minApprovals: 1,
    },
  };

  const issues = validateRegistryConfig(invalid);

  assert.ok(
    issues.some(
      (issue) => issue.code === "invalid_role_list",
    ),
  );
});
