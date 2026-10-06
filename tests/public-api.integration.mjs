import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseRegistryConfig,
} from "../packages/config/src/index.ts";
import {
  createDatabasePool,
  runMigrations,
  seedRegistry,
} from "../packages/database/src/index.ts";
import {
  getDatabasePool,
} from "../apps/web/lib/database.ts";
import {
  handleApiExport,
  handleApiRecord,
  handleApiRegistries,
  handleApiRegistry,
  handleApiSearch,
} from "../apps/web/lib/public-api.ts";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required for public API integration tests.",
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
const seed = JSON.parse(
  await readFile(
    "examples/generic-registry/seed.json",
    "utf8",
  ),
);

async function setup() {
  const pool = createDatabasePool({
    connectionString: databaseUrl,
    applicationName:
      "civic-registry-public-api-tests",
  });

  await runMigrations(pool);
  await pool.query(
    "TRUNCATE civic_registry_configurations CASCADE",
  );
  await seedRegistry(
    pool,
    config,
    seed,
  );

  return pool;
}

test.after(async () => {
  await getDatabasePool().end();
});

test("versioned registry endpoints expose only public policy metadata", async () => {
  const pool = await setup();

  try {
    const listResponse =
      await handleApiRegistries();
    const listPayload =
      await listResponse.json();

    assert.equal(listResponse.status, 200);
    assert.equal(
      listResponse.headers.get(
        "X-API-Version",
      ),
      "1",
    );
    assert.equal(
      listResponse.headers.get(
        "Access-Control-Allow-Origin",
      ),
      "*",
    );
    assert.equal(
      listPayload.apiVersion,
      "1",
    );
    assert.deepEqual(
      listPayload.data.map(
        (registry) => registry.id,
      ),
      ["public-document-catalog"],
    );

    const detailResponse =
      await handleApiRegistry(
        "public-document-catalog",
      );
    const detail =
      (await detailResponse.json()).data;

    assert.deepEqual(
      detail.publicLifecycleStatuses.map(
        (status) => status.id,
      ),
      [
        "published",
        "withdrawn",
        "archived",
      ],
    );
    assert.deepEqual(
      detail.publicDeadlineTypes.map(
        (deadline) => deadline.id,
      ),
      ["review_due"],
    );
  } finally {
    await pool.end();
  }
});

test("record, search, and exports never expose canonical redacted values", async () => {
  const pool = await setup();

  try {
    const secret =
      "ZEUS-API-PRIVATE-CANONICAL-VALUE";

    await pool.query(
      `
        UPDATE civic_registry_records
        SET fields = jsonb_set(
          fields,
          '{summary}',
          to_jsonb($3::text)
        )
        WHERE registry_id = $1
          AND id = $2
      `,
      [
        "public-document-catalog",
        "example-report",
        secret,
      ],
    );

    await pool.query(
      `
        INSERT INTO civic_registry_field_disclosures (
          registry_id,
          record_id,
          field_id,
          disposition,
          replacement_text,
          reason,
          authority,
          public_note,
          updated_at,
          actor_id
        )
        VALUES (
          $1, $2, 'summary', 'redacted',
          '[PUBLIC REDACTION]',
          'Privacy',
          'Example authority',
          'Summary withheld.',
          '2026-10-06T13:00:00.000Z',
          'reviewer-api'
        )
      `,
      [
        "public-document-catalog",
        "example-report",
      ],
    );

    const canonical = await pool.query(
      `
        SELECT fields
        FROM civic_registry_records
        WHERE registry_id = $1
          AND id = $2
      `,
      [
        "public-document-catalog",
        "example-report",
      ],
    );

    assert.equal(
      canonical.rows[0].fields.summary,
      secret,
    );

    const recordResponse =
      await handleApiRecord(
        "public-document-catalog",
        "example-report",
      );
    const recordPayload =
      await recordResponse.json();
    const serializedRecord =
      JSON.stringify(recordPayload);

    assert.doesNotMatch(
      serializedRecord,
      new RegExp(secret),
    );
    assert.equal(
      recordPayload.data.result.record
        .fields.summary,
      "[PUBLIC REDACTION]",
    );
    assert.equal(
      recordPayload.data.result.disclosure
        .fields.summary.reason,
      "Privacy",
    );

    const searchResponse =
      await handleApiSearch(
        new Request(
          `http://registry.test/api/v1/registries/public-document-catalog/search?q=${encodeURIComponent(secret)}`,
        ),
        "public-document-catalog",
      );
    const searchPayload =
      await searchResponse.json();

    assert.equal(
      searchPayload.data.result.total,
      0,
    );

    const jsonExport =
      await handleApiExport(
        new Request(
          "http://registry.test/api/v1/registries/public-document-catalog/export?format=json",
        ),
        "public-document-catalog",
      );
    const jsonBody =
      await jsonExport.text();

    assert.doesNotMatch(
      jsonBody,
      new RegExp(secret),
    );
    assert.match(
      jsonBody,
      /PUBLIC REDACTION/,
    );
    assert.equal(
      jsonExport.headers.get(
        "X-Export-Truncated",
      ),
      "false",
    );

    const csvExport =
      await handleApiExport(
        new Request(
          "http://registry.test/api/v1/registries/public-document-catalog/export?format=csv",
        ),
        "public-document-catalog",
      );
    const csvBody =
      await csvExport.text();

    assert.doesNotMatch(
      csvBody,
      new RegExp(secret),
    );
    assert.match(
      csvBody,
      /PUBLIC REDACTION/,
    );
  } finally {
    await pool.end();
  }
});

test("exports traverse result pages and report truncation explicitly", async () => {
  const pool = await setup();

  try {
    const response =
      await handleApiExport(
        new Request(
          "http://registry.test/api/v1/registries/public-document-catalog/export?format=json&maxRecords=1",
        ),
        "public-document-catalog",
      );
    const body = JSON.parse(
      await response.text(),
    );

    assert.equal(body.total, 2);
    assert.equal(body.exported, 1);
    assert.equal(body.truncated, true);
    assert.equal(
      response.headers.get(
        "X-Export-Total",
      ),
      "2",
    );
    assert.equal(
      response.headers.get(
        "X-Export-Count",
      ),
      "1",
    );
    assert.equal(
      response.headers.get(
        "X-Export-Truncated",
      ),
      "true",
    );
  } finally {
    await pool.end();
  }
});

test("versioned errors use one machine-readable envelope", async () => {
  const pool = await setup();

  try {
    const missingRecord =
      await handleApiRecord(
        "public-document-catalog",
        "missing-record",
      );
    const missingRecordBody =
      await missingRecord.json();

    assert.equal(
      missingRecord.status,
      404,
    );
    assert.equal(
      missingRecordBody.apiVersion,
      "1",
    );
    assert.equal(
      missingRecordBody.error.code,
      "record_not_found",
    );

    const missingRegistry =
      await handleApiRegistry(
        "missing-registry",
      );
    const missingRegistryBody =
      await missingRegistry.json();

    assert.equal(
      missingRegistry.status,
      404,
    );
    assert.equal(
      missingRegistryBody.error.code,
      "registry_not_found",
    );

    const invalidExport =
      await handleApiExport(
        new Request(
          "http://registry.test/api/v1/registries/public-document-catalog/export?format=xlsx",
        ),
        "public-document-catalog",
      );
    const invalidExportBody =
      await invalidExport.json();

    assert.equal(invalidExport.status, 400);
    assert.equal(
      invalidExportBody.error.code,
      "invalid_export_format",
    );
  } finally {
    await pool.end();
  }
});
