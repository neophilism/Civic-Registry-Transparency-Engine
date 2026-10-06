import assert from "node:assert/strict";
import test from "node:test";

import {
  compileRegistryConfig,
} from "../packages/config/src/index.ts";
import {
  presentHistoryEvent,
  presentRecordRevisions,
} from "../packages/registry/src/index.ts";

const registry = compileRegistryConfig({
  schemaVersion: 1,
  registry: {
    id: "history-test",
    name: "History Test",
    recordTypes: [
      {
        id: "item",
        name: "Item",
        pluralName: "Items",
        titleFieldId: "title",
        fields: [
          {
            id: "title",
            label: "Title",
            type: "text",
          },
          {
            id: "summary",
            label: "Summary",
            type: "longText",
          },
        ],
      },
    ],
    relationshipTypes: [
      {
        id: "related-to",
        label: "Related to",
        directed: false,
      },
      {
        id: "published-by",
        label: "Published by",
        inverseLabel: "Published",
        directed: true,
      },
    ],
  },
});

function record(summary, status = "draft") {
  return {
    id: "item-1",
    registryId: "history-test",
    recordTypeId: "item",
    fields: {
      title: "Example",
      summary,
    },
    status,
    visibility: "public",
    tags: [],
    externalIdentifiers: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

test("history event presentation resolves configured fields and relationships", () => {
  const current = record("Updated summary", "published");

  const fieldEvent = presentHistoryEvent(
    {
      id: "1",
      registryId: "history-test",
      subjectType: "record",
      subjectId: "item-1",
      eventType: "record.fields_changed",
      occurredAt: "2026-01-02T00:00:00.000Z",
      visibility: "public",
      metadata: {
        version: 2,
        changedFieldIds: ["summary"],
      },
    },
    current,
    registry,
  );

  assert.equal(fieldEvent.label, "Record fields changed");
  assert.equal(fieldEvent.detail, "Changed Summary.");
  assert.equal(fieldEvent.version, 2);

  const relationshipEvent = presentHistoryEvent(
    {
      id: "2",
      registryId: "history-test",
      subjectType: "record",
      subjectId: "item-1",
      eventType: "relationship.added",
      occurredAt: "2026-01-02T00:00:00.000Z",
      visibility: "public",
      metadata: {
        relationshipTypeId: "published-by",
        direction: "inbound",
        otherRecordId: "publisher-1",
      },
    },
    current,
    registry,
  );

  assert.equal(
    relationshipEvent.detail,
    "Published record publisher-1.",
  );
});

test("record revisions show human-readable field and status diffs", () => {
  const first = record("First summary");
  const second = {
    ...record("Second summary", "published"),
    updatedAt: "2026-01-02T00:00:00.000Z",
  };

  const revisions = presentRecordRevisions(
    [
      {
        id: "v2",
        registryId: "history-test",
        recordId: "item-1",
        version: 2,
        operation: "updated",
        visibility: "public",
        createdAt: "2026-01-02T00:00:00.000Z",
        snapshot: second,
      },
      {
        id: "v1",
        registryId: "history-test",
        recordId: "item-1",
        version: 1,
        operation: "created",
        visibility: "public",
        createdAt: "2026-01-01T00:00:00.000Z",
        snapshot: first,
      },
    ],
    registry,
  );

  assert.equal(revisions[0].version, 2);
  assert.deepEqual(
    revisions[0].changes.map((change) => change.label),
    ["Summary", "Status"],
  );
  assert.equal(
    revisions[0].changes[0].before,
    "First summary",
  );
  assert.equal(
    revisions[0].changes[0].after,
    "Second summary",
  );
});

test("baseline revisions explicitly disclose that earlier history is unavailable", () => {
  const revisions = presentRecordRevisions(
    [
      {
        id: "v1",
        registryId: "history-test",
        recordId: "item-1",
        version: 1,
        operation: "baseline",
        visibility: "public",
        createdAt: "2026-01-05T00:00:00.000Z",
        reason:
          "History tracking initialized for a pre-existing record.",
        snapshot: record("Existing"),
      },
    ],
    registry,
  );

  assert.match(
    revisions[0].baselineNotice,
    /earlier revisions are not reconstructed/i,
  );
});
