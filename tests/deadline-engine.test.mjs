import assert from "node:assert/strict";
import test from "node:test";

import {
  compileRegistryConfig,
  validateRegistryConfig,
} from "../packages/config/src/index.ts";
import {
  applyDeadlineOffset,
  calculateWarningAt,
  classifyDeadline,
  normalizeDeadlineAnchor,
  presentDeadline,
} from "../packages/deadlines/src/index.ts";

function baseConfig() {
  return {
    schemaVersion: 1,
    registry: {
      id: "deadline-test",
      name: "Deadline Test",
      recordTypes: [
        {
          id: "matter",
          name: "Matter",
          pluralName: "Matters",
          titleFieldId: "title",
          fields: [
            {
              id: "title",
              label: "Title",
              type: "text",
              required: true,
            },
            {
              id: "received_on",
              label: "Received on",
              type: "date",
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
          id: "review",
          label: "Review",
        },
        {
          id: "published",
          label: "Published",
          publiclyVisible: true,
          marksPublished: true,
        },
        {
          id: "closed",
          label: "Closed",
          publiclyVisible: true,
          terminal: true,
        },
      ],
      transitions: [
        {
          fromStatusId: "draft",
          toStatusId: "review",
        },
        {
          fromStatusId: "review",
          toStatusId: "published",
        },
        {
          fromStatusId: "published",
          toStatusId: "closed",
        },
      ],
    },
    deadlines: {
      calendars: [
        {
          id: "business",
          weekendDays: [0, 6],
          excludedDates: [
            "2026-01-01",
          ],
        },
      ],
      definitions: [
        {
          id: "response_due",
          label: "Response due",
          recordTypeIds: ["matter"],
          anchor: {
            kind: "field",
            fieldId: "received_on",
          },
          offset: {
            value: 20,
            unit: "businessDays",
          },
          warningOffset: {
            value: 5,
            unit: "businessDays",
          },
          calendarId: "business",
          dateOnlyAnchorTime: "end",
          pauseWhileStatuses: ["review"],
          completeWhenStatuses: ["closed"],
          publiclyVisible: true,
        },
      ],
    },
  };
}

test("compiles deadline definitions and calendars", () => {
  const compiled =
    compileRegistryConfig(baseConfig());

  assert.ok(compiled.deadlines);
  assert.equal(
    compiled.deadlines.getDefinition(
      "response_due",
    ).label,
    "Response due",
  );
  assert.deepEqual(
    [
      ...compiled.deadlines.getCalendar(
        "business",
      ).weekendDays,
    ],
    [0, 6],
  );
});

test("business-day arithmetic skips weekends and excluded dates", () => {
  const compiled =
    compileRegistryConfig(baseConfig());
  const calendar =
    compiled.deadlines.getCalendar("business");

  assert.equal(
    applyDeadlineOffset(
      "2025-12-31T23:59:59.999Z",
      {
        value: 2,
        unit: "businessDays",
      },
      calendar,
    ),
    "2026-01-05T23:59:59.999Z",
  );
});

test("date-only anchors default cleanly to start or end of day", () => {
  assert.equal(
    normalizeDeadlineAnchor("2026-02-03", {
      dateOnlyAnchorTime: "start",
    }),
    "2026-02-03T00:00:00.000Z",
  );
  assert.equal(
    normalizeDeadlineAnchor("2026-02-03", {
      dateOnlyAnchorTime: "end",
    }),
    "2026-02-03T23:59:59.999Z",
  );
});

test("warning windows and urgency classification use the configured calendar", () => {
  const compiled =
    compileRegistryConfig(baseConfig());
  const definition =
    compiled.deadlines.getDefinition(
      "response_due",
    );
  const calendar =
    compiled.deadlines.getCalendar("business");
  const deadline = {
    id: "deadline-1",
    registryId: "deadline-test",
    recordId: "matter-1",
    deadlineTypeId: "response_due",
    instanceKey: "automatic",
    anchorAt: "2026-01-01T23:59:59.999Z",
    dueAt: "2026-01-29T23:59:59.999Z",
    state: "open",
    totalPausedSeconds: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  assert.equal(
    calculateWarningAt(
      deadline.dueAt,
      definition,
      calendar,
    ),
    "2026-01-22T23:59:59.999Z",
  );
  assert.equal(
    classifyDeadline(
      deadline,
      definition,
      calendar,
      "2026-01-23T12:00:00.000Z",
    ),
    "due_soon",
  );
  assert.equal(
    classifyDeadline(
      deadline,
      definition,
      calendar,
      "2026-01-30T00:00:00.000Z",
    ),
    "overdue",
  );
});

test("presented deadlines are conservative about public visibility", () => {
  const compiled =
    compileRegistryConfig(baseConfig());
  const definition =
    compiled.deadlines.getDefinition(
      "response_due",
    );
  const calendar =
    compiled.deadlines.getCalendar("business");
  const presented = presentDeadline(
    {
      id: "deadline-1",
      registryId: "deadline-test",
      recordId: "matter-1",
      deadlineTypeId: "response_due",
      instanceKey: "automatic",
      anchorAt: "2026-01-01T23:59:59.999Z",
      dueAt: "2026-01-29T23:59:59.999Z",
      state: "completed",
      totalPausedSeconds: 0,
      completedAt: "2026-01-20T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-20T00:00:00.000Z",
    },
    definition,
    calendar,
    "2026-01-30T00:00:00.000Z",
  );

  assert.equal(presented.urgency, "completed");
  assert.equal(presented.publiclyVisible, true);
});

test("deadline validation rejects unsafe or ambiguous configuration", () => {
  const missingTypes = baseConfig();
  delete missingTypes.deadlines.definitions[0]
    .recordTypeIds;

  const missingTypeIssues =
    validateRegistryConfig(missingTypes);

  assert.ok(
    missingTypeIssues.some(
      (issue) =>
        issue.code ===
        "deadline_field_anchor_requires_record_types",
    ),
  );

  const badCalendar = baseConfig();
  badCalendar.deadlines.calendars[0]
    .weekendDays = [0, 1, 2, 3, 4, 5, 6];

  assert.ok(
    validateRegistryConfig(badCalendar).some(
      (issue) =>
        issue.code ===
        "deadline_calendar_has_no_business_days",
    ),
  );

  const conflicting = baseConfig();
  conflicting.deadlines.definitions[0]
    .cancelWhenStatuses = ["review"];

  assert.ok(
    validateRegistryConfig(conflicting).some(
      (issue) =>
        issue.code ===
        "conflicting_deadline_status_rule",
    ),
  );

  const unknownStatus = baseConfig();
  unknownStatus.deadlines.definitions[0]
    .pauseWhileStatuses = ["imaginary"];

  assert.ok(
    validateRegistryConfig(unknownStatus).some(
      (issue) =>
        issue.code ===
        "unknown_deadline_status",
    ),
  );
});
