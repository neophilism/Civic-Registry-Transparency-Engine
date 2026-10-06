import assert from "node:assert/strict";
import test from "node:test";

import {
  DomainValidationError,
  assertValidCitation,
  assertValidDocument,
  assertValidSource,
  validateCitation,
} from "../packages/core/src/index.ts";

const registry = {
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
          label: "Authority",
          type: "text",
        },
      ],
    },
  ],
};

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

test("source validation enforces registry, visibility, URLs, and timestamps", () => {
  assert.doesNotThrow(() =>
    assertValidSource(
      {
        id: "source-1",
        registryId: "evidence-test",
        title: "Official source",
        sourceType: "webpage",
        visibility: "public",
        canonicalUrl: "https://example.gov/source",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      "evidence-test",
    ),
  );

  assert.throws(
    () =>
      assertValidSource(
        {
          id: "source-2",
          registryId: "wrong",
          title: "Bad source",
          sourceType: "webpage",
          visibility: "public",
          canonicalUrl: "ftp://example.gov/source",
          createdAt: "not-a-date",
        },
        "evidence-test",
      ),
    DomainValidationError,
  );
});

test("document validation checks hashes and positive page counts", () => {
  assert.doesNotThrow(() =>
    assertValidDocument(
      {
        id: "doc-1",
        registryId: "evidence-test",
        title: "Official document",
        visibility: "public",
        sha256: "a".repeat(64),
        pageCount: 10,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      "evidence-test",
    ),
  );

  assert.throws(
    () =>
      assertValidDocument(
        {
          id: "doc-2",
          registryId: "evidence-test",
          title: "Broken document",
          visibility: "public",
          sha256: "xyz",
          pageCount: 0,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        "evidence-test",
      ),
    DomainValidationError,
  );
});

test("citation validation requires evidence and a valid configured field", () => {
  const missingEvidence = validateCitation(
    {
      id: "citation-1",
      registryId: "evidence-test",
      recordId: "item-1",
      visibility: "public",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    record,
    registry,
  );

  assert.ok(
    missingEvidence.some(
      (issue) => issue.code === "missing_evidence_target",
    ),
  );

  const badField = validateCitation(
    {
      id: "citation-2",
      registryId: "evidence-test",
      recordId: "item-1",
      fieldId: "missing",
      sourceId: "source-1",
      visibility: "public",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    record,
    registry,
  );

  assert.ok(
    badField.some(
      (issue) => issue.code === "unknown_citation_field",
    ),
  );
});

test("citation locator validation enforces positive ordered ranges", () => {
  assert.throws(
    () =>
      assertValidCitation(
        {
          id: "citation-3",
          registryId: "evidence-test",
          recordId: "item-1",
          sourceId: "source-1",
          locator: {
            page: 5,
            pageEnd: 3,
            lineStart: 20,
            lineEnd: 10,
          },
          visibility: "public",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        record,
        registry,
      ),
    (error) => {
      assert.ok(error instanceof DomainValidationError);
      assert.ok(
        error.issues.filter(
          (issue) => issue.code === "invalid_locator_range",
        ).length >= 2,
      );
      return true;
    },
  );
});
