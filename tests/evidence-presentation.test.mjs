import assert from "node:assert/strict";
import test from "node:test";

import {
  compileRegistryConfig,
} from "../packages/config/src/index.ts";
import {
  formatCitationLocator,
  groupPresentedCitations,
  presentCitation,
} from "../packages/registry/src/index.ts";

const registry = compileRegistryConfig({
  schemaVersion: 1,
  registry: {
    id: "evidence-test",
    name: "Evidence Test",
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
            id: "authority",
            label: "Legal authority",
            type: "text",
          },
        ],
      },
    ],
  },
});

const record = {
  id: "item-1",
  registryId: "evidence-test",
  recordTypeId: "item",
  fields: {
    title: "Example",
    authority: "Example authority",
  },
  status: "published",
  visibility: "public",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

test("citation locator formatting preserves precise ranges", () => {
  assert.equal(
    formatCitationLocator({
      page: 4,
      pageEnd: 6,
      section: "II.B",
      lineStart: 10,
      lineEnd: 14,
    }),
    "Pages 4–6 · Section II.B · Lines 10–14",
  );
});

test("citation presentation resolves configured field labels and omits storage keys", () => {
  const presented = presentCitation(
    {
      citation: {
        id: "citation-1",
        registryId: "evidence-test",
        recordId: "item-1",
        fieldId: "authority",
        sourceId: "source-1",
        documentId: "document-1",
        locator: {
          page: 2,
        },
        visibility: "public",
        createdAt: "2026-01-01T01:00:00.000Z",
      },
      source: {
        id: "source-1",
        registryId: "evidence-test",
        title: "Official source",
        sourceType: "webpage",
        visibility: "public",
        canonicalUrl: "https://example.gov/source",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      document: {
        id: "document-1",
        registryId: "evidence-test",
        title: "Official document",
        visibility: "public",
        storageKey: "internal/private/key.pdf",
        canonicalUrl: "https://example.gov/document.pdf",
        pageCount: 10,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    },
    record,
    registry,
  );

  assert.equal(presented.scopeLabel, "Legal authority");
  assert.equal(presented.locatorLabel, "Page 2");
  assert.equal(
    presented.document.canonicalUrl,
    "https://example.gov/document.pdf",
  );
  assert.equal(
    Object.hasOwn(presented.document, "storageKey"),
    false,
  );
});

test("citations group by whole-record and configured field scope", () => {
  const wholeRecord = presentCitation(
    {
      citation: {
        id: "whole",
        registryId: "evidence-test",
        recordId: "item-1",
        sourceId: "source-1",
        visibility: "public",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    },
    record,
    registry,
  );
  const fieldCitation = presentCitation(
    {
      citation: {
        id: "field",
        registryId: "evidence-test",
        recordId: "item-1",
        fieldId: "authority",
        sourceId: "source-1",
        visibility: "public",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    },
    record,
    registry,
  );

  const groups = groupPresentedCitations([
    fieldCitation,
    wholeRecord,
  ]);

  assert.equal(groups[0].label, "Whole record");
  assert.equal(groups[1].label, "Legal authority");
});
