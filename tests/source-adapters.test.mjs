import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  createPublicSourceClient,
  serializeAdapterRows,
} from "../packages/source-adapters/src/index.ts";
import {
  discoverDojOlcOpinions,
  dojOlcAdapter,
  parseDojOlcOpinion,
} from "../examples/open-legal-interpretations/adapters/doj-olc.ts";
import {
  discoverOgeLegalAdvisories,
  ogeLegalAdvisoriesAdapter,
  parseOgeLegalAdvisory,
} from "../examples/open-legal-interpretations/adapters/oge-legal-advisories.ts";

const retrievedAt =
  "2026-10-06T17:00:00.000Z";

function fixture(name) {
  return fs.readFileSync(
    "tests/fixtures/source-adapters/" +
      name,
    "utf8",
  );
}

test("DOJ OLC adapter discovers and normalizes official-opinion-shaped pages", async () => {
  const indexUrl =
    "https://www.justice.gov/olc/opinions";
  const detailUrl =
    "https://www.justice.gov/olc/opinion/example-separation-powers-opinion";
  const index =
    fixture("doj-olc-index.html");
  const detail =
    fixture("doj-olc-detail.html");

  const discovered =
    discoverDojOlcOpinions(
      index,
      indexUrl,
    );

  assert.equal(discovered.length, 1);
  assert.equal(
    discovered[0].url,
    detailUrl,
  );
  assert.equal(
    discovered[0].issuedOnHint,
    "September 17, 2026",
  );

  const row = parseDojOlcOpinion(
    detail,
    detailUrl,
    retrievedAt,
    discovered[0],
  );

  assert.equal(
    row.id,
    "doj-olc-example-separation-powers-opinion",
  );
  assert.equal(
    row.issued_on,
    "2026-09-17",
  );
  assert.equal(
    row.issuing_body,
    "usdoj-office-of-legal-counsel",
  );
  assert.equal(
    row.interpretation_type,
    "formal_opinion",
  );
  assert.deepEqual(
    row.attachment_urls,
    [
      "https://www.justice.gov/olc/file/example-opinion/dl",
    ],
  );

  const fakeClient = {
    async fetchText(url) {
      if (url === indexUrl) {
        return {
          requestedUrl: url,
          finalUrl: url,
          contentType: "text/html",
          body: index,
          fetchedAt: retrievedAt,
        };
      }

      if (url === detailUrl) {
        return {
          requestedUrl: url,
          finalUrl: url,
          contentType: "text/html",
          body: detail,
          fetchedAt: retrievedAt,
        };
      }

      throw new Error(
        "Unexpected fixture URL " + url,
      );
    },
  };

  const collection =
    await dojOlcAdapter.collect(
      fakeClient,
      {
        startUrls: [indexUrl],
        maxPages: 1,
        maxItems: 10,
        retrievedAt,
      },
    );

  assert.equal(
    collection.rows.length,
    1,
  );
  assert.equal(
    collection.warnings.length,
    0,
  );
});

test("OGE adapter discovers and normalizes Legal Advisory resource pages", async () => {
  const indexUrl =
    "https://www.oge.gov/web/OGE.nsf/Legal%20Research%20Search%20Collection";
  const detailUrl =
    "https://www.oge.gov/web/oge.nsf/Resources/LA-25-01%3A%2BExample%2BEthics%2BAdvisory";
  const index =
    fixture("oge-index.html");
  const detail =
    fixture("oge-detail.html");

  const discovered =
    discoverOgeLegalAdvisories(
      index,
      indexUrl,
    );

  assert.equal(discovered.length, 1);
  assert.equal(
    discovered[0].url,
    detailUrl,
  );

  const row =
    parseOgeLegalAdvisory(
      detail,
      detailUrl,
      retrievedAt,
      discovered[0],
    );

  assert.equal(row.id, "oge-la-25-01");
  assert.equal(
    row.interpretation_number,
    "LA-25-01",
  );
  assert.equal(
    row.issued_on,
    "2025-01-07",
  );
  assert.equal(
    row.issuing_body,
    "us-office-government-ethics",
  );
  assert.equal(
    row.interpretation_type,
    "guidance",
  );
  assert.deepEqual(
    row.attachment_urls,
    [
      "https://www.oge.gov/web/oge.nsf/Legal%20Docs/ABC/$FILE/LA-25-01.pdf?open=",
    ],
  );

  const fakeClient = {
    async fetchText(url) {
      if (url === indexUrl) {
        return {
          requestedUrl: url,
          finalUrl: url,
          contentType: "text/html",
          body: index,
          fetchedAt: retrievedAt,
        };
      }

      if (url === detailUrl) {
        return {
          requestedUrl: url,
          finalUrl: url,
          contentType: "text/html",
          body: detail,
          fetchedAt: retrievedAt,
        };
      }

      throw new Error(
        "Unexpected fixture URL " + url,
      );
    },
  };

  const collection =
    await ogeLegalAdvisoriesAdapter.collect(
      fakeClient,
      {
        startUrls: [indexUrl],
        maxPages: 1,
        maxItems: 10,
        retrievedAt,
      },
    );

  assert.equal(
    collection.rows.length,
    1,
  );
  assert.equal(
    collection.warnings.length,
    0,
  );
});

test("public source HTTP client blocks local/private destinations and unsafe redirects", async () => {
  const privateClient =
    createPublicSourceClient({
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
      "https://www.justice.gov/olc/opinions",
      ["www.justice.gov"],
    ),
    /private, local, or reserved/i,
  );

  const redirectClient =
    createPublicSourceClient({
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
            location:
              "https://attacker.example/internal",
          },
        }),
    });

  await assert.rejects(
    redirectClient.fetchText(
      "https://www.justice.gov/olc/opinions",
      ["www.justice.gov"],
    ),
    /not allowed/i,
  );
});

test("public source HTTP client enforces response size limits", async () => {
  const client =
    createPublicSourceClient({
      maxResponseBytes: 10,
      dnsLookup: async () => [
        {
          address: "8.8.8.8",
          family: 4,
        },
      ],
      fetchImpl: async () =>
        new Response(
          "01234567890",
          {
            status: 200,
            headers: {
              "content-type":
                "text/html",
              "content-length": "11",
            },
          },
        ),
    });

  await assert.rejects(
    client.fetchText(
      "https://www.justice.gov/olc/opinions",
      ["www.justice.gov"],
    ),
    /size limit/i,
  );
});

test("adapter NDJSON serialization is deterministic across object key order", () => {
  const left =
    serializeAdapterRows([
      {
        id: "record-1",
        external_id: "source:1",
        title: "Example",
        canonical_url:
          "https://example.gov/1",
        source_adapter: "example",
        retrieved_at: retrievedAt,
        tags: ["a", "b"],
      },
    ]);
  const right =
    serializeAdapterRows([
      {
        title: "Example",
        source_adapter: "example",
        retrieved_at: retrievedAt,
        id: "record-1",
        tags: ["a", "b"],
        canonical_url:
          "https://example.gov/1",
        external_id: "source:1",
      },
    ]);

  assert.equal(left, right);
});
