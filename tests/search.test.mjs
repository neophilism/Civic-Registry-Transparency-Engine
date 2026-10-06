import assert from "node:assert/strict";
import test from "node:test";

import {
  compileRegistryConfig,
} from "../packages/config/src/index.ts";
import {
  buildRecordSearchText,
  normalizeSearchRequest,
  SearchValidationError,
} from "../packages/search/src/index.ts";

const registry = compileRegistryConfig({
  schemaVersion: 1,
  registry: {
    id: "search-test",
    name: "Search Test",
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
            searchable: true,
            sortable: true,
          },
          {
            id: "secret_note",
            label: "Secret note",
            type: "text",
          },
          {
            id: "category",
            label: "Category",
            type: "enum",
            filterable: true,
            options: [
              { value: "alpha", label: "Alpha category" },
              { value: "beta", label: "Beta category" },
            ],
          },
          {
            id: "published_on",
            label: "Published on",
            type: "date",
            filterable: true,
            sortable: true,
          },
        ],
      },
    ],
  },
});

const record = {
  id: "item-1",
  registryId: "search-test",
  recordTypeId: "item",
  fields: {
    title: "Open government report",
    secret_note: "This should never enter the full text index",
    category: "alpha",
    published_on: "2026-01-01",
  },
  status: "published",
  visibility: "public",
  tags: ["transparency", "annual"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

test("search text includes only searchable fields plus record id and tags", () => {
  const text = buildRecordSearchText(record, registry);

  assert.match(text, /item-1/);
  assert.match(text, /transparency/);
  assert.match(text, /Open government report/);
  assert.doesNotMatch(text, /never enter/);
  assert.doesNotMatch(text, /Alpha category/);
});

test("search request normalization trims, deduplicates, and clamps pagination", () => {
  const normalized = normalizeSearchRequest(registry, {
    registryId: "search-test",
    recordTypeId: "item",
    text: "  open government  ",
    statuses: ["published", "published", ""],
    tags: ["annual", " annual "],
    fieldFilters: [
      {
        fieldId: "category",
        values: ["alpha", "alpha"],
      },
    ],
    rangeFilters: [
      {
        fieldId: "published_on",
        from: "2026-01-01",
        to: "2026-12-31",
      },
    ],
    page: 0,
    pageSize: 500,
  });

  assert.equal(normalized.text, "open government");
  assert.deepEqual(normalized.statuses, ["published"]);
  assert.deepEqual(normalized.tags, ["annual"]);
  assert.deepEqual(normalized.fieldFilters[0].values, ["alpha"]);
  assert.equal(normalized.page, 1);
  assert.equal(normalized.pageSize, 100);
});

test("configured field filtering requires a selected record type", () => {
  assert.throws(
    () =>
      normalizeSearchRequest(registry, {
        registryId: "search-test",
        fieldFilters: [
          {
            fieldId: "category",
            values: ["alpha"],
          },
        ],
      }),
    (error) => {
      assert.ok(error instanceof SearchValidationError);
      assert.ok(
        error.issues.some(
          (issue) => issue.code === "record_type_required",
        ),
      );
      return true;
    },
  );
});

test("non-filterable and non-sortable fields are rejected", () => {
  assert.throws(
    () =>
      normalizeSearchRequest(registry, {
        registryId: "search-test",
        recordTypeId: "item",
        fieldFilters: [
          {
            fieldId: "secret_note",
            values: ["anything"],
          },
        ],
        sort: {
          by: "field",
          fieldId: "secret_note",
        },
      }),
    (error) => {
      assert.ok(error instanceof SearchValidationError);
      const codes = new Set(error.issues.map((issue) => issue.code));
      assert.ok(codes.has("field_not_filterable"));
      assert.ok(codes.has("field_not_sortable"));
      return true;
    },
  );
});
