import assert from "node:assert/strict";
import test from "node:test";

import {
  compileRegistryConfig,
} from "../packages/config/src/index.ts";
import {
  compileIngestionProfile,
  decodeIngestionInput,
  mapIngestionRow,
  parseIngestionProfile,
  sha256Fingerprint,
  validateIngestionProfile,
} from "../packages/ingestion/src/index.ts";

function registry() {
  return compileRegistryConfig({
    schemaVersion: 1,
    registry: {
      id: "ingestion-test",
      name: "Ingestion Test",
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
            },
            {
              id: "count",
              label: "Count",
              type: "integer",
            },
            {
              id: "active",
              label: "Active",
              type: "boolean",
            },
            {
              id: "labels",
              label: "Labels",
              type: "entityRefList",
              targetRecordTypeIds: ["item"],
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
  });
}

function profile() {
  return compileIngestionProfile(
    {
      id: "items",
      recordTypeId: "item",
      mode: "upsert",
      recordId: {
        path: "id",
        trim: true,
        required: true,
      },
      sourceKey: {
        path: "source.key",
        required: true,
      },
      fields: {
        title: {
          path: "title",
          trim: true,
          required: true,
        },
        count: {
          path: "count",
        },
        active: {
          path: "active",
        },
        labels: {
          path: "labels",
          split: "|",
          trim: true,
        },
      },
      status: {
        literal: "published",
      },
      tags: {
        path: "tags",
        split: ";",
        trim: true,
      },
      staticTags: ["imported"],
      externalIdentifiers: [
        {
          scheme: "source",
          value: {
            path: "source.key",
          },
        },
      ],
      allowLifecycleBootstrap: true,
    },
    registry(),
  );
}

test("JSON decoder isolates non-object rows and fingerprints valid rows", () => {
  const result = decodeIngestionInput(
    JSON.stringify([
      {
        id: "a",
        title: "Alpha",
      },
      "bad-row",
      {
        id: "b",
        title: "Beta",
      },
    ]),
    "json",
  );

  assert.equal(result.rows.length, 2);
  assert.equal(result.issues.length, 1);
  assert.equal(
    result.issues[0].code,
    "row_not_object",
  );
  assert.equal(result.rows[0].index, 0);
  assert.equal(result.rows[1].index, 2);
  assert.match(
    result.rows[0].fingerprint,
    /^[0-9a-f]{64}$/,
  );
});

test("NDJSON decoder continues after a malformed row", () => {
  const result = decodeIngestionInput(
    [
      '{"id":"a","title":"Alpha"}',
      '{"broken":',
      '{"id":"b","title":"Beta"}',
    ].join("\n"),
    "ndjson",
  );

  assert.deepEqual(
    result.rows.map((row) => row.index),
    [0, 2],
  );
  assert.equal(
    result.issues[0].code,
    "ndjson_parse_error",
  );
  assert.equal(result.issues[0].line, 2);
});

test("CSV decoder handles quoting, embedded commas, and escaped quotes", () => {
  const result = decodeIngestionInput(
    [
      "id,title,note",
      'a,"Alpha, Incorporated","He said ""yes"""',
      "b,Beta,plain",
    ].join("\n"),
    "csv",
  );

  assert.equal(result.issues.length, 0);
  assert.deepEqual(
    result.rows[0].value,
    {
      id: "a",
      title: "Alpha, Incorporated",
      note: 'He said "yes"',
    },
  );
  assert.equal(result.rows[0].line, 2);
});

test("CSV decoder reports row column mismatches without losing valid rows", () => {
  const result = decodeIngestionInput(
    [
      "id,title",
      "a,Alpha",
      "bad,too,many",
      "b,Beta",
    ].join("\n"),
    "csv",
  );

  assert.deepEqual(
    result.rows.map((row) => row.value.id),
    ["a", "b"],
  );
  assert.equal(
    result.issues[0].code,
    "csv_column_count_mismatch",
  );
  assert.equal(result.issues[0].line, 3);
});

test("profile validation rejects unknown target fields and unsafe lifecycle statuses", () => {
  const issues = validateIngestionProfile(
    {
      id: "bad-profile",
      recordTypeId: "item",
      recordId: {
        path: "id",
      },
      fields: {
        imaginary: {
          path: "value",
        },
      },
      status: {
        literal: "imaginary",
      },
    },
    registry(),
  );

  assert.ok(
    issues.some(
      (issue) =>
        issue.code ===
        "unknown_ingestion_field",
    ),
  );
  assert.ok(
    issues.some(
      (issue) =>
        issue.code ===
        "unknown_ingestion_status",
    ),
  );
});

test("YAML import profiles compile independently from registry policy configuration", () => {
  const compiled = parseIngestionProfile(
    [
      "id: yaml-items",
      "recordTypeId: item",
      "recordId:",
      "  path: id",
      "fields:",
      "  title:",
      "    path: title",
      "status:",
      "  literal: draft",
    ].join("\n"),
    registry(),
  );

  assert.equal(compiled.id, "yaml-items");
  assert.equal(compiled.mode, "upsert");
  assert.equal(compiled.replaceFields, false);
});

test("mapping performs schema-aware coercion and nested path extraction", () => {
  const decoded = decodeIngestionInput(
    JSON.stringify([
      {
        id: " item-1 ",
        title: " Example item ",
        count: "42",
        active: "yes",
        labels: "left | right",
        tags: "alpha; beta",
        source: {
          key: "EXT-17",
        },
      },
    ]),
    "json",
  );
  const mapped = mapIngestionRow(
    decoded.rows[0],
    profile(),
    registry(),
    {
      now: "2026-01-01T12:00:00.000Z",
    },
  );

  assert.equal(mapped.ok, true);

  if (!mapped.ok) return;

  assert.equal(mapped.item.record.id, "item-1");
  assert.equal(
    mapped.item.record.fields.title,
    "Example item",
  );
  assert.equal(
    mapped.item.record.fields.count,
    42,
  );
  assert.equal(
    mapped.item.record.fields.active,
    true,
  );
  assert.deepEqual(
    mapped.item.record.fields.labels,
    ["left", "right"],
  );
  assert.deepEqual(
    mapped.item.record.tags,
    ["imported", "alpha", "beta"],
  );
  assert.deepEqual(
    mapped.item.record.externalIdentifiers,
    [
      {
        scheme: "source",
        value: "EXT-17",
      },
    ],
  );
  assert.equal(
    mapped.item.record.status,
    "published",
  );
});

test("mapping reports domain validation issues instead of manufacturing invalid records", () => {
  const decoded = decodeIngestionInput(
    JSON.stringify([
      {
        id: "item-1",
        title: "",
        count: "not-a-number",
        source: {
          key: "EXT-18",
        },
      },
    ]),
    "json",
  );
  const mapped = mapIngestionRow(
    decoded.rows[0],
    profile(),
    registry(),
    {
      now: "2026-01-01T12:00:00.000Z",
    },
  );

  assert.equal(mapped.ok, false);

  if (mapped.ok) return;

  assert.ok(
    mapped.issues.some(
      (issue) =>
        issue.code ===
        "field_coercion_failed",
    ),
  );
});

test("fingerprints are stable across object key ordering", () => {
  assert.equal(
    sha256Fingerprint({
      b: 2,
      a: 1,
    }),
    sha256Fingerprint({
      a: 1,
      b: 2,
    }),
  );
});
