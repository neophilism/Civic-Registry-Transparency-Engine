import assert from "node:assert/strict";
import test from "node:test";

import {
  compileRegistryConfig,
} from "../packages/config/src/index.ts";
import {
  formatFieldValue,
  presentRecordDetail,
  presentRecordSummary,
} from "../packages/registry/src/index.ts";

const config = compileRegistryConfig({
  schemaVersion: 1,
  registry: {
    id: "presentation-test",
    name: "Presentation Test",
    recordTypes: [
      {
        id: "entry",
        name: "Entry",
        pluralName: "Entries",
        titleFieldId: "name",
        summaryFieldId: "summary",
        fields: [
          {
            id: "name",
            label: "Name",
            type: "text",
            required: true,
          },
          {
            id: "summary",
            label: "Summary",
            type: "longText",
          },
          {
            id: "category",
            label: "Category",
            type: "enum",
            options: [
              { value: "alpha", label: "Alpha category" },
              { value: "beta", label: "Beta category" },
            ],
          },
          {
            id: "active",
            label: "Active",
            type: "boolean",
          },
        ],
      },
    ],
  },
  presentation: {
    recordTypes: {
      entry: {
        listFields: ["name", "category"],
        detailFields: [
          "name",
          "summary",
          "category",
          "active",
        ],
      },
    },
  },
});

const record = {
  id: "entry-1",
  registryId: "presentation-test",
  recordTypeId: "entry",
  fields: {
    name: "Example entry",
    summary: "Example summary",
    category: "alpha",
    active: true,
  },
  status: "published",
  visibility: "public",
  tags: ["example"],
  externalIdentifiers: [
    {
      scheme: "example",
      value: "123",
      url: "https://example.gov/123",
    },
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  publishedAt: "2026-01-01T01:00:00.000Z",
};

test("summary presentation follows configured list fields", () => {
  const presented = presentRecordSummary(record, config);

  assert.equal(presented.title, "Example entry");
  assert.equal(presented.summary, "Example summary");
  assert.equal(presented.recordTypeName, "Entry");
  assert.equal(presented.statusLabel, "published");
  assert.deepEqual(
    presented.fields.map((field) => [
      field.id,
      field.displayValue,
    ]),
    [
      ["name", "Example entry"],
      ["category", "Alpha category"],
    ],
  );
});

test("detail presentation follows configured detail fields", () => {
  const presented = presentRecordDetail(record, config);

  assert.deepEqual(
    presented.fields.map((field) => field.id),
    ["name", "summary", "category", "active"],
  );
  assert.equal(
    presented.fields.find((field) => field.id === "active")
      ?.displayValue,
    "Yes",
  );
  assert.deepEqual(presented.tags, ["example"]);
});

test("field formatter uses enum labels and generic fallbacks", () => {
  const enumField = config.getField("entry", "category");
  const boolField = config.getField("entry", "active");

  assert.equal(
    formatFieldValue(enumField, "beta"),
    "Beta category",
  );
  assert.equal(formatFieldValue(enumField, "unknown"), "unknown");
  assert.equal(formatFieldValue(boolField, false), "No");
});
