import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
} from "node:fs/promises";
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
  PostgresPdfAttachmentService,
  PostgresRecordHistoryRepository,
  PostgresRecordRepository,
  PostgresRegistryConfigRepository,
  PostgresSourceRepository,
  runMigrations,
  seedRegistry,
} from "../packages/database/src/index.ts";
import {
  PostgresDeadlineService,
} from "../packages/database/src/deadlines.ts";

import {
  createTextPdf,
} from "./helpers/pdf-fixture.mjs";
import {
  processOpenLegalInterpretationAttachments,
} from "../examples/open-legal-interpretations/adapters/attachment-processing.ts";

const databaseUrl =
  process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required for database integration tests.",
  );
}

const configSource =
  await import(
    "node:fs/promises"
  ).then(({ readFile }) =>
    readFile(
      "examples/open-legal-interpretations/registry.yaml",
      "utf8",
    ),
  );
const seedSource =
  await import(
    "node:fs/promises"
  ).then(({ readFile }) =>
    readFile(
      "examples/open-legal-interpretations/seed.json",
      "utf8",
    ),
  );
const config =
  parseRegistryConfig(
    configSource,
    {
      sourceName:
        "examples/open-legal-interpretations/registry.yaml",
    },
  );
const seed = JSON.parse(seedSource);

test("PDF attachment ingestion materializes idempotent evidence and preserves changed content versions", async () => {
  const pool = createDatabasePool({
    connectionString: databaseUrl,
    applicationName:
      "civic-registry-pdf-attachment-tests",
  });
  const root =
    await mkdtemp(
      join(
        tmpdir(),
        "civic-pdf-evidence-",
      ),
    );

  try {
    await runMigrations(pool);
    await pool.query(
      "TRUNCATE civic_registry_configurations CASCADE",
    );
    await seedRegistry(
      pool,
      config,
      seed,
    );

    const configs =
      new PostgresRegistryConfigRepository(
        pool,
      );
    const sources =
      new PostgresSourceRepository(
        pool,
        configs,
      );
    const documents =
      new PostgresDocumentRepository(
        pool,
        configs,
        sources,
      );
    const records =
      new PostgresRecordRepository(
        pool,
        configs,
        new PostgresDeadlineService(
          pool,
        ),
      );
    const citations =
      new PostgresCitationRepository(
        pool,
        configs,
        records,
        sources,
        documents,
      );

    let currentPdf =
      createTextPdf(
        "First official opinion text",
      );
    const attachmentUrl =
      "https://example.gov/opinion.pdf";
    const client = {
      async fetchText() {
        throw new Error(
          "Attachment test does not use text fetch.",
        );
      },
      async fetchBytes(url) {
        assert.equal(
          url,
          attachmentUrl,
        );

        return {
          requestedUrl: url,
          finalUrl: url,
          contentType:
            "application/pdf",
          body: currentPdf,
          fetchedAt:
            "2026-10-06T18:30:00.000Z",
        };
      },
    };
    const service =
      new PostgresPdfAttachmentService(
        pool,
        new FileSystemDocumentStorage(
          root,
        ),
        {
          client,
        },
      );
    const input = {
      registryId:
        "open-legal-interpretations",
      recordId:
        "demo-interpretation-2026-02",
      recordTitle:
        "Example Interpretation on Publication",
      attachmentUrls: [
        attachmentUrl,
      ],
      allowedHosts: [
        "example.gov",
      ],
      visibility: "public",
      fieldId: "full_text",
      retrievedAt:
        "2026-10-06T18:30:00.000Z",
    };

    const first =
      await service.ingest(input);

    assert.equal(
      first.failed,
      0,
      JSON.stringify(first.items, null, 2),
    );
    assert.equal(
      first.created,
      1,
      JSON.stringify(first.items, null, 2),
    );
    assert.match(
      first.extractedText,
      /First official opinion text/,
    );
    assert.match(
      first.items[0]?.sha256 ?? "",
      /^[a-f0-9]{64}$/,
    );
    assert.match(
      first.items[0]?.storageKey ??
        "",
      /^sha256\/[a-f0-9]{2}\/[a-f0-9]{64}\.pdf$/,
    );

    const firstDocumentId =
      first.items[0]?.documentId;

    assert.ok(firstDocumentId);

    const extraction =
      await service.getExtraction(
        input.registryId,
        firstDocumentId,
      );

    assert.ok(extraction);
    assert.equal(
      extraction.pages.length,
      1,
    );
    assert.match(
      extraction.text,
      /First official opinion text/,
    );

    const firstCitations =
      await citations.listForRecord(
        input.registryId,
        input.recordId,
        {
          fieldId: "full_text",
          limit: 20,
        },
      );

    assert.equal(
      firstCitations.length,
      1,
    );
    assert.equal(
      firstCitations[0]?.documentId,
      firstDocumentId,
    );
    assert.deepEqual(
      firstCitations[0]?.locator,
      {
        page: 1,
        pageEnd: 1,
      },
    );

    const repeated =
      await service.ingest(input);

    assert.equal(
      repeated.created,
      0,
    );
    assert.equal(
      repeated.existing,
      1,
    );
    assert.equal(
      (
        await citations.listForRecord(
          input.registryId,
          input.recordId,
          {
            fieldId:
              "full_text",
            limit: 20,
          },
        )
      ).length,
      1,
    );

    currentPdf =
      createTextPdf(
        "Second revised official opinion text",
      );

    const changed =
      await service.ingest({
        ...input,
        retrievedAt:
          "2026-10-06T19:00:00.000Z",
      });

    assert.equal(
      changed.created,
      1,
    );
    assert.equal(
      changed.failed,
      0,
    );
    assert.notEqual(
      changed.items[0]?.documentId,
      firstDocumentId,
    );
    assert.match(
      changed.extractedText,
      /Second revised official opinion text/,
    );

    const sourceId =
      changed.items[0]?.sourceId;

    assert.ok(sourceId);

    const sourceDocuments =
      await documents.list(
        input.registryId,
        {
          sourceId,
          limit: 20,
        },
      );

    assert.equal(
      sourceDocuments.length,
      2,
    );
    assert.notEqual(
      sourceDocuments[0]?.sha256,
      sourceDocuments[1]?.sha256,
    );

    const versionCitations =
      await citations.listForRecord(
        input.registryId,
        input.recordId,
        {
          fieldId: "full_text",
          limit: 20,
        },
      );

    assert.equal(
      versionCitations.length,
      2,
    );

    const source =
      await sources.get(
        input.registryId,
        sourceId,
      );

    assert.equal(
      source?.canonicalUrl,
      attachmentUrl,
    );
    assert.equal(
      source?.sourceType,
      "document",
    );

    const processed =
      await processOpenLegalInterpretationAttachments({
        registryId:
          input.registryId,
        row: {
          id: input.recordId,
          external_id:
            "refresh:test",
          title:
            input.recordTitle,
          canonical_url:
            "https://example.gov/interpretation",
          source_adapter:
            "refresh-test",
          retrieved_at:
            "2026-10-06T19:00:00.000Z",
          attachment_urls: [
            attachmentUrl,
          ],
        },
        allowedHosts: [
          "example.gov",
        ],
        attachments:
          service,
        records,
      });

    assert.equal(
      processed.fullTextUpdated,
      true,
    );
    assert.equal(
      processed.attachmentExisting,
      1,
    );

    const enriched =
      await records.get(
        input.registryId,
        input.recordId,
      );

    assert.match(
      String(
        enriched?.fields.full_text ??
          "",
      ),
      /Second revised official opinion text/,
    );

    const repeatedEnrichment =
      await processOpenLegalInterpretationAttachments({
        registryId:
          input.registryId,
        row: {
          id: input.recordId,
          external_id:
            "refresh:test",
          title:
            input.recordTitle,
          canonical_url:
            "https://example.gov/interpretation",
          source_adapter:
            "refresh-test",
          retrieved_at:
            "2026-10-06T19:05:00.000Z",
          attachment_urls: [
            attachmentUrl,
          ],
        },
        allowedHosts: [
          "example.gov",
        ],
        attachments:
          service,
        records,
      });

    assert.equal(
      repeatedEnrichment.fullTextUpdated,
      false,
    );

    const history =
      await new PostgresRecordHistoryRepository(
        pool,
      ).listVersions(
        input.registryId,
        input.recordId,
        {
          limit: 20,
        },
      );

    assert.ok(
      history.some(
        (version) =>
          version.reason ===
          "Refresh full text from retrieved PDF attachment.",
      ),
    );

    const integrity =
      await new PostgresIntegrityService(
        pool,
      ).verifyRegistry(
        input.registryId,
      );

    assert.equal(
      integrity.valid,
      true,
    );
  } finally {
    await pool.end();
    await rm(root, {
      recursive: true,
      force: true,
    });
  }
});
