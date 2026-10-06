import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  compileRegistryConfig,
  parseRegistryConfig,
} from "../packages/config/src/index.ts";
import {
  createDatabasePool,
  PostgresRecordRepository,
  PostgresRegistryConfigRepository,
  PostgresSearchProvider,
  rebuildRegistrySearchIndex,
  runMigrations,
  seedRegistry,
} from "../packages/database/src/index.ts";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for search integration tests.");
}

const config = parseRegistryConfig(
  await readFile(
    "examples/generic-registry/registry.yaml",
    "utf8",
  ),
  {
    sourceName: "examples/generic-registry/registry.yaml",
  },
);
const compiled = compileRegistryConfig(config);
const seed = JSON.parse(
  await readFile(
    "examples/generic-registry/seed.json",
    "utf8",
  ),
);

function additionalDocument({
  id,
  title,
  summary,
  type,
  date,
  visibility = "public",
}) {
  return {
    id,
    registryId: config.registry.id,
    recordTypeId: "document",
    fields: {
      title,
      summary,
      document_type: type,
      published_on: date,
      publisher: "example-agency",
    },
    status: "published",
    visibility,
    tags: ["example", type],
    externalIdentifiers: [],
    createdAt: `${date}T12:00:00.000Z`,
    updatedAt: `${date}T12:00:00.000Z`,
    publishedAt: `${date}T12:00:00.000Z`,
  };
}

async function setup() {
  const pool = createDatabasePool({
    connectionString: databaseUrl,
    applicationName: "civic-registry-search-tests",
  });

  await runMigrations(pool);
  await pool.query(
    "TRUNCATE civic_registry_configurations CASCADE",
  );
  await seedRegistry(pool, config, seed);

  const configs = new PostgresRegistryConfigRepository(pool);
  const records = new PostgresRecordRepository(pool, configs);

  await records.create(
    additionalDocument({
      id: "emergency-policy",
      title: "Emergency Communications Policy",
      summary: "Continuity and resilient communications requirements.",
      type: "policy",
      date: "2026-02-10",
    }),
    { bootstrapLifecycle: true },
  );

  await records.create(
    additionalDocument({
      id: "public-notice",
      title: "Public Notice on Records Access",
      summary: "Notice describing how residents may access public records.",
      type: "notice",
      date: "2026-03-15",
    }),
    { bootstrapLifecycle: true },
  );

  await records.create(
    additionalDocument({
      id: "private-report",
      title: "Private Internal Report",
      summary: "This record must not appear in public search.",
      type: "report",
      date: "2026-04-01",
      visibility: "private",
    }),
    { bootstrapLifecycle: true },
  );

  return {
    pool,
    provider: new PostgresSearchProvider(pool),
  };
}

test("PostgreSQL search supports text, facets, field filters, ranges, sorting, and pagination", async () => {
  const { pool, provider } = await setup();

  try {
    const textResult = await provider.search(compiled, {
      registryId: config.registry.id,
      recordTypeId: "document",
      text: "communications",
      visibility: "public",
    });

    assert.equal(textResult.total, 1);
    assert.equal(
      textResult.hits[0].record.id,
      "emergency-policy",
    );

    const allPublic = await provider.search(compiled, {
      registryId: config.registry.id,
      recordTypeId: "document",
      visibility: "public",
      sort: {
        by: "field",
        fieldId: "published_on",
        direction: "asc",
      },
      pageSize: 2,
    });

    assert.equal(allPublic.total, 3);
    assert.equal(allPublic.hits.length, 2);
    assert.equal(
      allPublic.hits[0].record.id,
      "example-report",
    );

    const typeFacet =
      allPublic.facets.fields.document_type;
    assert.equal(typeFacet.kind, "terms");
    assert.deepEqual(
      new Set(typeFacet.buckets.map((bucket) => bucket.value)),
      new Set(["report", "policy", "notice"]),
    );

    const dateFacet =
      allPublic.facets.fields.published_on;
    assert.equal(dateFacet.kind, "range");
    assert.equal(dateFacet.min, "2026-01-15");
    assert.equal(dateFacet.max, "2026-03-15");

    const filtered = await provider.search(compiled, {
      registryId: config.registry.id,
      recordTypeId: "document",
      visibility: "public",
      fieldFilters: [
        {
          fieldId: "document_type",
          values: ["policy"],
        },
      ],
      rangeFilters: [
        {
          fieldId: "published_on",
          from: "2026-02-01",
          to: "2026-02-28",
        },
      ],
    });

    assert.equal(filtered.total, 1);
    assert.equal(
      filtered.hits[0].record.id,
      "emergency-policy",
    );

    const secondPage = await provider.search(compiled, {
      registryId: config.registry.id,
      recordTypeId: "document",
      visibility: "public",
      sort: {
        by: "field",
        fieldId: "published_on",
        direction: "asc",
      },
      page: 2,
      pageSize: 2,
    });

    assert.equal(secondPage.total, 3);
    assert.equal(secondPage.hits.length, 1);
    assert.equal(
      secondPage.hits[0].record.id,
      "public-notice",
    );
  } finally {
    await pool.end();
  }
});

test("reindexing restores full-text search for existing records", async () => {
  const { pool, provider } = await setup();

  try {
    await pool.query(
      `
        UPDATE civic_registry_records
        SET search_text = ''
        WHERE registry_id = $1
      `,
      [config.registry.id],
    );

    const before = await provider.search(compiled, {
      registryId: config.registry.id,
      recordTypeId: "document",
      text: "communications",
      visibility: "public",
    });
    assert.equal(before.total, 0);

    const count = await rebuildRegistrySearchIndex(
      pool,
      compiled,
    );
    assert.equal(count, 5);

    const after = await provider.search(compiled, {
      registryId: config.registry.id,
      recordTypeId: "document",
      text: "communications",
      visibility: "public",
    });
    assert.equal(after.total, 1);
    assert.equal(
      after.hits[0].record.id,
      "emergency-policy",
    );
  } finally {
    await pool.end();
  }
});
