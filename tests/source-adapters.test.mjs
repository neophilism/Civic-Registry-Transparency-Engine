import assert from "node:assert/strict";
import test from "node:test";

import {
  createPublicSourceClient,
  runSourceAdapter,
  serializeAdapterRows,
} from "../packages/source-adapters/src/index.ts";

const retrievedAt = "2026-10-07T16:00:00.000Z";

test("generic source adapters collect and serialize deterministic rows", async () => {
  const adapter = {
    id: "example-adapter",
    label: "Example adapter",
    allowedHosts: ["example.gov"],
    defaultStartUrls: ["https://example.gov/catalog"],
    async collect(_client, options = {}) {
      return {
        rows: [
          {
            id: "record-b",
            external_id: "example:b",
            title: "Record B",
            canonical_url: "https://example.gov/b",
            source_adapter: "example-adapter",
            retrieved_at: options.retrievedAt ?? retrievedAt,
          },
          {
            title: "Record A",
            retrieved_at: options.retrievedAt ?? retrievedAt,
            source_adapter: "example-adapter",
            canonical_url: "https://example.gov/a",
            external_id: "example:a",
            id: "record-a",
          },
          {
            id: "record-a-duplicate",
            external_id: "example:a-duplicate",
            title: "Duplicate canonical URL",
            canonical_url: "https://example.gov/a",
            source_adapter: "example-adapter",
            retrieved_at: options.retrievedAt ?? retrievedAt,
          },
        ],
        sourcePages: [
          "https://example.gov/catalog",
          "https://example.gov/catalog",
        ],
        warnings: [],
      };
    },
  };

  const result = await runSourceAdapter(adapter, {
    retrievedAt,
  });

  assert.equal(result.rows.length, 2);
  assert.deepEqual(
    result.rows.map((row) => row.id),
    ["record-a", "record-b"],
  );
  assert.equal(result.manifest.adapterId, "example-adapter");
  assert.equal(result.manifest.rowCount, 2);
  assert.deepEqual(
    result.manifest.sourcePages,
    ["https://example.gov/catalog"],
  );
  assert.match(result.manifest.outputSha256, /^[a-f0-9]{64}$/);
});

test("public source HTTP client blocks local/private destinations and unsafe redirects", async () => {
  const privateClient = createPublicSourceClient({
    dnsLookup: async () => [
      {
        address: "127.0.0.1",
        family: 4,
      },
    ],
    fetchImpl: async () =>
      new Response("never reached"),
  });

  await assert.rejects(
    privateClient.fetchText(
      "https://example.gov/catalog",
      ["example.gov"],
    ),
    /private, local, or reserved/i,
  );

  const redirectClient = createPublicSourceClient({
    dnsLookup: async () => [
      {
        address: "8.8.8.8",
        family: 4,
      },
    ],
    fetchImpl: async () =>
      new Response(null, {
        status: 302,
        headers: {
          location: "https://attacker.example/internal",
        },
      }),
  });

  await assert.rejects(
    redirectClient.fetchText(
      "https://example.gov/catalog",
      ["example.gov"],
    ),
    /not allowed/i,
  );
});

test("public source HTTP client enforces response size limits", async () => {
  const client = createPublicSourceClient({
    maxResponseBytes: 10,
    dnsLookup: async () => [
      {
        address: "8.8.8.8",
        family: 4,
      },
    ],
    fetchImpl: async () =>
      new Response("01234567890", {
        status: 200,
        headers: {
          "content-type": "text/html",
          "content-length": "11",
        },
      }),
  });

  await assert.rejects(
    client.fetchText(
      "https://example.gov/catalog",
      ["example.gov"],
    ),
    /size limit/i,
  );
});

test("adapter NDJSON serialization is deterministic across object key order", () => {
  const left = serializeAdapterRows([
    {
      id: "record-1",
      external_id: "source:1",
      title: "Example",
      canonical_url: "https://example.gov/1",
      source_adapter: "example",
      retrieved_at: retrievedAt,
      tags: ["a", "b"],
    },
  ]);
  const right = serializeAdapterRows([
    {
      title: "Example",
      source_adapter: "example",
      retrieved_at: retrievedAt,
      id: "record-1",
      tags: ["a", "b"],
      canonical_url: "https://example.gov/1",
      external_id: "source:1",
    },
  ]);

  assert.equal(left, right);
});
