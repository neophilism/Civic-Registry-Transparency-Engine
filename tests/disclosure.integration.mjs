import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  compileRegistryConfig,
  parseRegistryConfig,
} from "../packages/config/src/index.ts";
import {
  createDatabasePool,
  PostgresCitationRepository,
  PostgresDisclosureRepository,
  PostgresDocumentRepository,
  PostgresRecordHistoryRepository,
  PostgresRecordRepository,
  PostgresRegistryConfigRepository,
  PostgresSearchProvider,
  PostgresSourceRepository,
  runMigrations,
} from "../packages/database/src/index.ts";
import {
  getDatabasePool,
} from "../apps/web/lib/database.ts";
import {
  getPublicEvidence,
  getPublicHistory,
  getPublicRecordView,
  getPublicRegistry,
  searchPublicRecords,
} from "../apps/web/lib/public-registry.ts";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required for disclosure integration tests.",
  );
}

const config = parseRegistryConfig(
  await readFile(
    "examples/generic-registry/registry.yaml",
    "utf8",
  ),
  {
    sourceName:
      "examples/generic-registry/registry.yaml",
  },
);
const compiled = compileRegistryConfig(config);

test.after(async () => {
  await getDatabasePool().end();
});

function publicDocument(id, title) {
  return {
    id,
    registryId: config.registry.id,
    recordTypeId: "document",
    fields: {
      title,
      summary: "Visible summary before disclosure.",
      document_type: "report",
      published_on: "2026-05-01",
      publisher: "example-agency",
    },
    status: "published",
    visibility: "public",
    tags: ["classified-tag"],
    externalIdentifiers: [
      {
        scheme: "internal",
        value: "SECRET-IDENTIFIER",
      },
    ],
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    publishedAt: "2026-05-01T00:00:00.000Z",
  };
}

async function setup() {
  const pool = createDatabasePool({
    connectionString: databaseUrl,
    applicationName:
      "civic-registry-disclosure-tests",
  });

  await runMigrations(pool);
  await pool.query(
    "TRUNCATE civic_registry_configurations CASCADE",
  );

  const configs =
    new PostgresRegistryConfigRepository(pool);
  const records =
    new PostgresRecordRepository(pool, configs);
  const sources =
    new PostgresSourceRepository(pool, configs);
  const documents =
    new PostgresDocumentRepository(
      pool,
      configs,
      sources,
    );
  const citations =
    new PostgresCitationRepository(
      pool,
      configs,
      records,
      sources,
      documents,
    );
  const disclosure =
    new PostgresDisclosureRepository(
      pool,
      configs,
      records,
      documents,
    );

  await configs.upsert(config);

  await records.create(
    {
      id: "example-agency",
      registryId: config.registry.id,
      recordTypeId: "organization",
      fields: {
        name: "Example Agency",
        website: "https://agency.example.test",
      },
      status: "published",
      visibility: "public",
      tags: [],
      externalIdentifiers: [],
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
      publishedAt: "2026-05-01T00:00:00.000Z",
    },
    {
      bootstrapLifecycle: true,
    },
  );

  return {
    pool,
    configs,
    records,
    sources,
    documents,
    citations,
    disclosure,
    history:
      new PostgresRecordHistoryRepository(pool),
    search: new PostgresSearchProvider(pool),
  };
}

test("field redactions protect public lookup, search, facets, evidence, and history", async () => {
  const {
    pool,
    records,
    sources,
    documents,
    citations,
    disclosure,
    history,
    search,
  } = await setup();

  try {
    await records.create(
      publicDocument(
        "secret-report",
        "Project Zephyr secret title",
      ),
      {
        bootstrapLifecycle: true,
      },
    );

    await sources.create({
      id: "source-1",
      registryId: config.registry.id,
      title: "Public source",
      sourceType: "webpage",
      visibility: "public",
      canonicalUrl:
        "https://example.test/source",
      createdAt: "2026-05-01T00:00:00.000Z",
    });

    await documents.create({
      id: "document-1",
      registryId: config.registry.id,
      title: "Original sensitive PDF",
      visibility: "public",
      sourceId: "source-1",
      fileName: "original.pdf",
      mimeType: "application/pdf",
      storageKey: "private/original.pdf",
      canonicalUrl:
        "https://example.test/original.pdf",
      sha256:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      pageCount: 10,
      createdAt: "2026-05-01T00:00:00.000Z",
    });

    await citations.create({
      id: "title-citation",
      registryId: config.registry.id,
      recordId: "secret-report",
      fieldId: "title",
      documentId: "document-1",
      visibility: "public",
      note: "Field-scoped evidence",
      createdAt: "2026-05-01T00:10:00.000Z",
    });

    await citations.create({
      id: "record-citation",
      registryId: config.registry.id,
      recordId: "secret-report",
      documentId: "document-1",
      visibility: "public",
      note: "Whole-record evidence",
      createdAt: "2026-05-01T00:11:00.000Z",
    });

    await disclosure.setFieldDisclosure({
      registryId: config.registry.id,
      recordId: "secret-report",
      fieldId: "title",
      disposition: "redacted",
      reason: "Personal privacy",
      authority: "Example authority",
      publicNote: "Name removed.",
      updatedAt: "2026-05-02T00:00:00.000Z",
      actorId: "reviewer-1",
    });

    await disclosure.setFieldDisclosure({
      registryId: config.registry.id,
      recordId: "secret-report",
      fieldId: "document_type",
      disposition: "withheld",
      updatedAt: "2026-05-02T00:01:00.000Z",
      actorId: "reviewer-1",
    });

    await disclosure.setDocumentDisclosure({
      registryId: config.registry.id,
      documentId: "document-1",
      disposition: "redacted",
      publicCanonicalUrl:
        "https://example.test/redacted.pdf",
      publicStorageKey: "public/redacted.pdf",
      reason: "Personal privacy",
      authority: "Example authority",
      updatedAt: "2026-05-02T00:02:00.000Z",
      actorId: "reviewer-1",
    });

    await disclosure.upsertDocumentRedaction({
      id: "document-redaction-1",
      registryId: config.registry.id,
      documentId: "document-1",
      locator: {
        page: 2,
        pageEnd: 3,
      },
      reason: "Personal privacy",
      publicNote: "Names removed.",
      createdAt: "2026-05-02T00:03:00.000Z",
      actorId: "reviewer-1",
    });

    const stored = await pool.query(
      "SELECT fields, public_fields, public_search_text FROM civic_registry_records WHERE registry_id = $1 AND id = $2",
      [config.registry.id, "secret-report"],
    );

    assert.equal(
      stored.rows[0].fields.title,
      "Project Zephyr secret title",
    );
    assert.equal(
      stored.rows[0].public_fields.title,
      "[REDACTED]",
    );
    assert.equal(
      stored.rows[0].public_fields.document_type,
      "[WITHHELD]",
    );
    assert.doesNotMatch(
      stored.rows[0].public_search_text,
      /Zephyr/i,
    );

    const internalSearch = await search.search(
      compiled,
      {
        registryId: config.registry.id,
        text: "Zephyr",
        visibility: "public",
      },
    );
    const publicSearch = await search.search(
      compiled,
      {
        registryId: config.registry.id,
        text: "Zephyr",
        visibility: "public",
        projection: "public",
      },
    );

    assert.equal(internalSearch.total, 1);
    assert.equal(publicSearch.total, 0);

    const internalFilter = await search.search(
      compiled,
      {
        registryId: config.registry.id,
        recordTypeId: "document",
        fieldFilters: [
          {
            fieldId: "document_type",
            values: ["report"],
          },
        ],
        visibility: "public",
      },
    );
    const publicFilter = await search.search(
      compiled,
      {
        registryId: config.registry.id,
        recordTypeId: "document",
        fieldFilters: [
          {
            fieldId: "document_type",
            values: ["report"],
          },
        ],
        visibility: "public",
        projection: "public",
      },
    );

    assert.equal(internalFilter.total, 1);
    assert.equal(publicFilter.total, 0);
    assert.ok(
      publicFilter.facets.fields.document_type
        .kind === "terms",
    );
    assert.ok(
      !publicFilter.facets.fields.document_type
        .buckets.some(
          (bucket) => bucket.value === "report",
        ),
    );

    await pool.query(
      "UPDATE civic_registry_records SET fields = jsonb_set(fields, '{title}', to_jsonb('Nimbus direct SQL secret'::text)), updated_at = '2026-05-03T00:00:00.000Z' WHERE registry_id = $1 AND id = $2",
      [config.registry.id, "secret-report"],
    );

    const afterSql = await pool.query(
      "SELECT fields, public_fields, public_search_text FROM civic_registry_records WHERE registry_id = $1 AND id = $2",
      [config.registry.id, "secret-report"],
    );

    assert.equal(
      afterSql.rows[0].fields.title,
      "Nimbus direct SQL secret",
    );
    assert.equal(
      afterSql.rows[0].public_fields.title,
      "[REDACTED]",
    );
    assert.doesNotMatch(
      afterSql.rows[0].public_search_text,
      /Nimbus/i,
    );

    const publicRegistry = await getPublicRegistry(
      config.registry.id,
    );
    const recordView = await getPublicRecordView(
      config.registry.id,
      "secret-report",
    );

    assert.ok(publicRegistry);
    assert.ok(recordView);
    assert.equal(
      recordView.record.fields.title,
      "[REDACTED]",
    );
    assert.equal(
      recordView.disclosure.fields.title.reason,
      "Personal privacy",
    );

    const publicWebSearch =
      await searchPublicRecords(
        publicRegistry.config,
        {
          text: "Nimbus",
          pageSize: 25,
        },
      );

    assert.equal(publicWebSearch.total, 0);

    const evidence = await getPublicEvidence(
      publicRegistry.config,
      recordView.record,
    );

    assert.deepEqual(
      evidence.citations.map(
        (citation) => citation.id,
      ),
      ["record-citation"],
    );
    assert.equal(
      evidence.citations[0].document.canonicalUrl,
      "https://example.test/redacted.pdf",
    );
    assert.equal(
      evidence.citations[0].document.sha256,
      undefined,
    );
    assert.equal(
      evidence.citations[0].document.disclosure
        .redactions.length,
      1,
    );

    const publicHistory = await getPublicHistory(
      publicRegistry.config,
      recordView.record,
    );
    const serializedHistory =
      JSON.stringify(publicHistory);

    assert.doesNotMatch(
      serializedHistory,
      /Zephyr|Nimbus/i,
    );
    assert.match(
      serializedHistory,
      /REDACTED/,
    );

    const disclosureEvents =
      await history.listEvents(
        config.registry.id,
        "secret-report",
      );

    assert.ok(
      disclosureEvents.some(
        (event) =>
          event.eventType ===
          "disclosure.field_changed",
      ),
    );
  } finally {
    await pool.end();
  }
});

test("whole-record withholding supports placeholders and hidden-mode search exclusion", async () => {
  const {
    pool,
    configs,
    records,
    disclosure,
    search,
  } = await setup();

  try {
    await records.create(
      publicDocument(
        "withheld-report",
        "Orchid highly sensitive title",
      ),
      {
        bootstrapLifecycle: true,
      },
    );

    await disclosure.setRecordDisclosure({
      registryId: config.registry.id,
      recordId: "withheld-report",
      disposition: "withheld",
      reason: "Pending disclosure review",
      updatedAt: "2026-06-01T00:00:00.000Z",
      actorId: "reviewer-2",
    });

    const stored = await pool.query(
      "SELECT public_fields, public_search_text FROM civic_registry_records WHERE registry_id = $1 AND id = $2",
      [config.registry.id, "withheld-report"],
    );

    assert.deepEqual(
      stored.rows[0].public_fields,
      {},
    );
    assert.equal(
      stored.rows[0].public_search_text,
      "withheld-report",
    );

    const placeholderView =
      await getPublicRecordView(
        config.registry.id,
        "withheld-report",
      );

    assert.ok(placeholderView);
    assert.equal(
      placeholderView.record.fields.title,
      "Record withheld",
    );
    assert.deepEqual(
      placeholderView.record.tags,
      [],
    );
    assert.deepEqual(
      placeholderView.record.externalIdentifiers,
      [],
    );

    const publicSearch = await search.search(
      compiled,
      {
        registryId: config.registry.id,
        text: "Orchid",
        visibility: "public",
        projection: "public",
      },
    );

    assert.equal(publicSearch.total, 0);

    const hiddenConfig = structuredClone(config);
    hiddenConfig.disclosure = {
      ...hiddenConfig.disclosure,
      withheldRecordBehavior: "hidden",
    };
    await configs.upsert(hiddenConfig);
    const hiddenCompiled =
      compileRegistryConfig(hiddenConfig);

    const hiddenSearch = await search.search(
      hiddenCompiled,
      {
        registryId: config.registry.id,
        visibility: "public",
        projection: "public",
      },
    );

    assert.equal(hiddenSearch.total, 1);
    assert.ok(
      !hiddenSearch.hits.some(
        (hit) =>
          hit.record.id === "withheld-report",
      ),
    );

    const listed = await records.list(
      config.registry.id,
      {
        visibility: "public",
        excludeWithheld: true,
        limit: 100,
      },
    );

    assert.ok(
      !listed.some(
        (item) =>
          item.id === "withheld-report",
      ),
    );

    assert.equal(
      await getPublicRecordView(
        config.registry.id,
        "withheld-report",
      ),
      null,
    );
  } finally {
    await pool.end();
  }
});
