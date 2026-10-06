import assert from "node:assert/strict";
import test from "node:test";

import {
  compileRegistryConfig,
  validateRegistryConfig,
} from "../packages/config/src/index.ts";
import {
  projectDocumentForPublic,
  projectRecordForPublic,
} from "../packages/registry/src/index.ts";

function config(overrides = {}) {
  return {
    schemaVersion: 1,
    registry: {
      id: "disclosure-test",
      name: "Disclosure Test",
      recordTypes: [
        {
          id: "item",
          name: "Item",
          pluralName: "Items",
          titleFieldId: "title",
          summaryFieldId: "summary",
          fields: [
            {
              id: "title",
              label: "Title",
              type: "text",
              required: true,
              searchable: true,
            },
            {
              id: "summary",
              label: "Summary",
              type: "longText",
              searchable: true,
            },
          ],
        },
      ],
    },
    disclosure: {
      withheldRecordBehavior: "placeholder",
      defaultRedactionText: "[MASKED]",
      defaultWithheldFieldText: "[NOT DISCLOSED]",
      withheldRecordTitle: "Withheld record",
      withheldRecordSummary:
        "The public contents are withheld.",
      withheldDocumentTitle: "Withheld document",
      showReasons: true,
      showAuthorities: true,
      ...overrides,
    },
  };
}

function record() {
  return {
    id: "item-1",
    registryId: "disclosure-test",
    recordTypeId: "item",
    fields: {
      title: "Sensitive title",
      summary: "Secret summary",
    },
    status: "published",
    visibility: "public",
    tags: ["sensitive-tag"],
    externalIdentifiers: [
      {
        scheme: "internal",
        value: "SECRET-42",
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

test("disclosure configuration compiles safe defaults", () => {
  const compiled = compileRegistryConfig({
    schemaVersion: 1,
    registry: config().registry,
  });

  assert.equal(
    compiled.disclosure.withheldRecordBehavior,
    "placeholder",
  );
  assert.equal(
    compiled.disclosure.defaultRedactionText,
    "[REDACTED]",
  );
  assert.equal(
    compiled.disclosure.defaultWithheldFieldText,
    "[WITHHELD]",
  );
  assert.equal(compiled.disclosure.showReasons, true);
  assert.equal(
    compiled.disclosure.showAuthorities,
    true,
  );
});

test("invalid disclosure behavior and blank replacement text are rejected", () => {
  const candidate = config();
  candidate.disclosure.withheldRecordBehavior =
    "sometimes";
  candidate.disclosure.defaultRedactionText = " ";

  const issues = validateRegistryConfig(candidate);

  assert.ok(
    issues.some(
      (issue) =>
        issue.code ===
        "invalid_withheld_record_behavior",
    ),
  );
  assert.ok(
    issues.some(
      (issue) =>
        issue.code === "invalid_disclosure_text",
    ),
  );
});

test("field disclosure replaces public values without mutating canonical data", () => {
  const compiled = compileRegistryConfig(config());
  const canonical = record();
  const result = projectRecordForPublic(
    canonical,
    compiled,
    null,
    [
      {
        registryId: canonical.registryId,
        recordId: canonical.id,
        fieldId: "summary",
        disposition: "redacted",
        reason: "Personal privacy",
        authority: "Example authority",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    ],
  );

  assert.ok(result.record);
  assert.equal(
    result.record.fields.summary,
    "[MASKED]",
  );
  assert.equal(
    canonical.fields.summary,
    "Secret summary",
  );
  assert.equal(
    result.disclosure.fields.summary.reason,
    "Personal privacy",
  );
  assert.equal(
    result.disclosure.fields.summary.authority,
    "Example authority",
  );
});

test("whole-record placeholder strips fields, tags, and identifiers", () => {
  const compiled = compileRegistryConfig(config());
  const canonical = record();
  const result = projectRecordForPublic(
    canonical,
    compiled,
    {
      registryId: canonical.registryId,
      recordId: canonical.id,
      disposition: "withheld",
      reason: "Pending review",
      updatedAt: "2026-01-02T00:00:00.000Z",
    },
    [],
  );

  assert.ok(result.record);
  assert.deepEqual(result.record.fields, {
    title: "Withheld record",
    summary: "The public contents are withheld.",
  });
  assert.deepEqual(result.record.tags, []);
  assert.deepEqual(
    result.record.externalIdentifiers,
    [],
  );
  assert.equal(
    result.disclosure.disposition,
    "withheld",
  );
});

test("hidden whole-record withholding removes the public record", () => {
  const compiled = compileRegistryConfig(
    config({
      withheldRecordBehavior: "hidden",
    }),
  );
  const canonical = record();
  const result = projectRecordForPublic(
    canonical,
    compiled,
    {
      registryId: canonical.registryId,
      recordId: canonical.id,
      disposition: "withheld",
      updatedAt: "2026-01-02T00:00:00.000Z",
    },
    [],
  );

  assert.equal(result.record, null);
});

test("redacted documents suppress original artifact links and hashes", () => {
  const compiled = compileRegistryConfig(config());
  const document = {
    id: "doc-1",
    registryId: "disclosure-test",
    title: "Sensitive filing",
    visibility: "public",
    fileName: "original.pdf",
    mimeType: "application/pdf",
    storageKey: "private/original.pdf",
    canonicalUrl:
      "https://example.test/original.pdf",
    sha256:
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    pageCount: 12,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const result = projectDocumentForPublic(
    document,
    compiled,
    {
      registryId: document.registryId,
      documentId: document.id,
      disposition: "redacted",
      publicCanonicalUrl:
        "https://example.test/redacted.pdf",
      publicStorageKey: "public/redacted.pdf",
      reason: "Personal privacy",
      updatedAt: "2026-01-02T00:00:00.000Z",
    },
    [
      {
        id: "redaction-1",
        registryId: document.registryId,
        documentId: document.id,
        locator: {
          page: 4,
          pageEnd: 5,
        },
        reason: "Personal privacy",
        createdAt: "2026-01-02T00:00:00.000Z",
      },
    ],
  );

  assert.equal(
    result.document.canonicalUrl,
    "https://example.test/redacted.pdf",
  );
  assert.equal(
    result.document.storageKey,
    "public/redacted.pdf",
  );
  assert.equal(result.document.sha256, undefined);
  assert.equal(
    result.disclosure.redactions.length,
    1,
  );
});

test("reason and authority visibility can be disabled by configuration", () => {
  const compiled = compileRegistryConfig(
    config({
      showReasons: false,
      showAuthorities: false,
    }),
  );
  const canonical = record();
  const result = projectRecordForPublic(
    canonical,
    compiled,
    null,
    [
      {
        registryId: canonical.registryId,
        recordId: canonical.id,
        fieldId: "title",
        disposition: "redacted",
        reason: "Hidden reason",
        authority: "Hidden authority",
        publicNote: "Public note",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    ],
  );

  assert.equal(
    result.disclosure.fields.title.reason,
    undefined,
  );
  assert.equal(
    result.disclosure.fields.title.authority,
    undefined,
  );
  assert.equal(
    result.disclosure.fields.title.publicNote,
    "Public note",
  );
});
