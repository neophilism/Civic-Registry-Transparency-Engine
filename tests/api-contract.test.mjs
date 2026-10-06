import assert from "node:assert/strict";
import test from "node:test";

import {
  compileRegistryConfig,
} from "../packages/config/src/index.ts";
import {
  buildPublicApiOpenApiDocument,
  publicRegistryDetail,
  serializePublicRecordExport,
} from "../packages/api/src/index.ts";

function registry() {
  return compileRegistryConfig({
    schemaVersion: 1,
    registry: {
      id: "api-test",
      name: "API Test",
      publicByDefault: true,
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
              required: true,
              searchable: true,
              sortable: true,
            },
            {
              id: "note",
              label: "Note",
              type: "longText",
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
          id: "published",
          label: "Published",
          publiclyVisible: true,
          marksPublished: true,
        },
      ],
      transitions: [
        {
          fromStatusId: "draft",
          toStatusId: "published",
        },
      ],
    },
    deadlines: {
      definitions: [
        {
          id: "public_due",
          label: "Public due",
          anchor: {
            kind: "createdAt",
          },
          offset: {
            value: 1,
            unit: "calendarDays",
          },
          publiclyVisible: true,
        },
        {
          id: "internal_due",
          label: "Internal due",
          anchor: {
            kind: "createdAt",
          },
          offset: {
            value: 2,
            unit: "calendarDays",
          },
          publiclyVisible: false,
        },
      ],
    },
  });
}

function record(fields = {}) {
  return {
    id: "item-1",
    registryId: "api-test",
    recordTypeId: "item",
    fields: {
      title: "Example",
      note: "Example note",
      ...fields,
    },
    status: "published",
    visibility: "public",
    tags: ["alpha"],
    externalIdentifiers: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    publishedAt: "2026-01-02T00:00:00.000Z",
  };
}

test("public registry metadata exposes only public lifecycle and deadline definitions", () => {
  const detail = publicRegistryDetail(
    registry(),
  );

  assert.deepEqual(
    detail.publicLifecycleStatuses.map(
      (status) => status.id,
    ),
    ["published"],
  );
  assert.deepEqual(
    detail.publicDeadlineTypes.map(
      (deadline) => deadline.id,
    ),
    ["public_due"],
  );
  assert.equal(
    detail.recordTypes[0].fields[0].searchable,
    true,
  );
});

test("JSON export carries versioned metadata and public records", () => {
  const compiled = registry();
  const result = serializePublicRecordExport(
    compiled,
    [record()],
    {
      format: "json",
      generatedAt:
        "2026-01-03T00:00:00.000Z",
      total: 1,
      truncated: false,
    },
  );
  const parsed = JSON.parse(result.body);

  assert.equal(parsed.apiVersion, "1");
  assert.equal(parsed.total, 1);
  assert.equal(parsed.exported, 1);
  assert.equal(
    parsed.records[0].fields.title,
    "Example",
  );
  assert.equal(
    result.contentType,
    "application/json; charset=utf-8",
  );
});

test("NDJSON export emits exactly one JSON object per record", () => {
  const result = serializePublicRecordExport(
    registry(),
    [
      record(),
      {
        ...record(),
        id: "item-2",
      },
    ],
    {
      format: "ndjson",
      generatedAt:
        "2026-01-03T00:00:00.000Z",
      total: 2,
      truncated: false,
    },
  );
  const lines = result.body
    .trim()
    .split("\n");

  assert.equal(lines.length, 2);
  assert.equal(
    JSON.parse(lines[1]).id,
    "item-2",
  );
});

test("CSV export is deterministic, quotes special text, and neutralizes spreadsheet formulas", () => {
  const result = serializePublicRecordExport(
    registry(),
    [
      record({
        title: "=HYPERLINK(\"https://bad.example\")",
        note: 'Alpha, "Beta"',
      }),
    ],
    {
      format: "csv",
      generatedAt:
        "2026-01-03T00:00:00.000Z",
      total: 1,
      truncated: false,
    },
  );
  const [header, row] =
    result.body.trimEnd().split("\r\n");

  assert.equal(
    header,
    "id,recordTypeId,status,visibility,createdAt,updatedAt,publishedAt,tags,externalIdentifiers,field.title,field.note",
  );
  assert.match(
    row,
    /'=HYPERLINK/,
  );
  assert.match(
    row,
    /"Alpha, ""Beta"""/,
  );
});

test("OpenAPI document declares the complete versioned public surface", () => {
  const document =
    buildPublicApiOpenApiDocument();

  assert.equal(document.openapi, "3.1.0");
  assert.equal(
    document.servers[0].url,
    "/api/v1",
  );

  for (const path of [
    "/registries",
    "/registries/{registryId}",
    "/registries/{registryId}/records",
    "/registries/{registryId}/search",
    "/registries/{registryId}/records/{recordId}",
    "/registries/{registryId}/records/{recordId}/evidence",
    "/registries/{registryId}/records/{recordId}/history",
    "/registries/{registryId}/records/{recordId}/relationships",
    "/registries/{registryId}/records/{recordId}/graph",
    "/registries/{registryId}/records/{recordId}/deadlines",
    "/registries/{registryId}/export",
    "/openapi.json",
  ]) {
    assert.ok(document.paths[path], path);
  }
});
