import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  parseRegistryConfig,
} from "../packages/config/src/index.ts";
import {
  FileSystemDocumentStorage,
} from "../packages/documents/src/index.ts";
import {
  createDatabasePool,
  PostgresCitationRepository,
  PostgresDocumentRepository,
  PostgresIntegrityService,
  PostgresRecordRepository,
  PostgresRegistryConfigRepository,
  PostgresSourceRepository,
  runMigrations,
  seedRegistry,
} from "../packages/database/src/index.ts";
import {
  PostgresPdfAttachmentService,
} from "../packages/database/src/attachments.ts";

import { createTextPdf } from "./helpers/pdf-fixture.mjs";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for database integration tests.");
}

const [configSource, seedSource] = await Promise.all([
  readFile("examples/generic-registry/registry.yaml", "utf8"),
  readFile("examples/generic-registry/seed.json", "utf8"),
]);
const config = parseRegistryConfig(configSource, {
  sourceName: "examples/generic-registry/registry.yaml",
});
const seed = JSON.parse(seedSource);

test("PDF attachment ingestion materializes idempotent evidence and preserves changed content versions", async () => {
  const pool = createDatabasePool({
    connectionString: databaseUrl,
    applicationName: "civic-registry-pdf-attachment-tests",
  });
  const root = await mkdtemp(
    join(tmpdir(), "civic-pdf-evidence-"),
  );

  try {
    await runMigrations(pool);
    await pool.query(
      "TRUNCATE civic_registry_configurations CASCADE",
    );
    await seedRegistry(pool, config, seed);

    const configs = new PostgresRegistryConfigRepository(pool);
    const sources = new PostgresSourceRepository(pool, configs);
    const documents = new PostgresDocumentRepository(
      pool,
      configs,
      sources,
    );
    const records = new PostgresRecordRepository(pool, configs);
    const citations = new PostgresCitationRepository(
      pool,
      configs,
      records,
      sources,
      documents,
    );

    let currentPdf = createTextPdf(
      "First generic public document text",
    );
    const attachmentUrl =
      "https://example.gov/reports/example.pdf";
    const client = {
      async fetchText() {
        throw new Error("Attachment test does not use text fetch.");
      },
      async fetchBytes(url) {
        assert.equal(url, attachmentUrl);
        return {
          requestedUrl: url,
          finalUrl: url,
          contentType: "application/pdf",
          body: currentPdf,
          fetchedAt: "2026-10-07T18:30:00.000Z",
        };
      },
    };

    const service = new PostgresPdfAttachmentService(
      pool,
      new FileSystemDocumentStorage(root),
      { client },
    );
    const input = {
      registryId: config.registry.id,
      recordId: "example-report",
      recordTitle: "Example Annual Report",
      attachmentUrls: [attachmentUrl],
      allowedHosts: ["example.gov"],
      visibility: "public",
      fieldId: "summary",
      retrievedAt: "2026-10-07T18:30:00.000Z",
    };

    const first = await service.ingest(input);
    assert.equal(first.failed, 0);
    assert.equal(first.created, 1);
    assert.match(
      first.extractedText,
      /First generic public document text/,
    );
    const firstDocumentId = first.items[0]?.documentId;
    assert.ok(firstDocumentId);

    const firstCitations = await citations.listForRecord(
      input.registryId,
      input.recordId,
      { fieldId: "summary", limit: 20 },
    );
    assert.equal(firstCitations.length, 2);

    const repeated = await service.ingest(input);
    assert.equal(repeated.created, 0);
    assert.equal(repeated.existing, 1);

    currentPdf = createTextPdf(
      "Second revised generic public document text",
    );
    const changed = await service.ingest({
      ...input,
      retrievedAt: "2026-10-07T19:00:00.000Z",
    });
    assert.equal(changed.created, 1);
    assert.notEqual(
      changed.items[0]?.documentId,
      firstDocumentId,
    );

    const sourceId = changed.items[0]?.sourceId;
    assert.ok(sourceId);
    const sourceDocuments = await documents.list(
      input.registryId,
      { sourceId, limit: 20 },
    );
    assert.equal(sourceDocuments.length, 2);

    const source = await sources.get(
      input.registryId,
      sourceId,
    );
    assert.equal(source?.canonicalUrl, attachmentUrl);

    const integrity = await new PostgresIntegrityService(
      pool,
    ).verifyRegistry(input.registryId);
    assert.equal(integrity.valid, true);
  } finally {
    await pool.end();
    await rm(root, { recursive: true, force: true });
  }
});
