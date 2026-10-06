import assert from "node:assert/strict";
import test from "node:test";

import {
  CivicRegistryApiError,
  CivicRegistryClient,
} from "../packages/sdk/src/index.ts";

test("SDK normalizes site roots, preserves custom Headers, and unwraps versioned envelopes", async () => {
  let requestedUrl;
  let requestedHeaders;

  const client = new CivicRegistryClient({
    baseUrl: "https://registry.example/",
    headers: new Headers({
      "X-Test-Header": "present",
    }),
    fetch: async (input, init) => {
      requestedUrl = String(input);
      requestedHeaders =
        new Headers(init?.headers);

      return Response.json({
        apiVersion: "1",
        data: [
          {
            id: "registry-one",
            name: "Registry One",
          },
        ],
      });
    },
  });

  const result =
    await client.listRegistries();

  assert.equal(
    requestedUrl,
    "https://registry.example/api/v1/registries",
  );
  assert.equal(
    requestedHeaders.get("X-Test-Header"),
    "present",
  );
  assert.equal(
    requestedHeaders.get("Accept"),
    "application/json",
  );
  assert.deepEqual(result, [
    {
      id: "registry-one",
      name: "Registry One",
    },
  ]);
});

test("SDK does not append a second API prefix", async () => {
  let requestedUrl;

  const client = new CivicRegistryClient({
    baseUrl:
      "https://registry.example/api/v1/",
    fetch: async (input) => {
      requestedUrl = String(input);

      return Response.json({
        apiVersion: "1",
        data: {
          id: "registry-one",
          name: "Registry One",
          recordTypes: [],
          relationshipTypes: [],
          publicLifecycleStatuses: [],
          publicDeadlineTypes: [],
        },
      });
    },
  });

  await client.getRegistry(
    "registry one",
  );

  assert.equal(
    requestedUrl,
    "https://registry.example/api/v1/registries/registry%20one",
  );
});

test("SDK serializes repeated query parameters", async () => {
  let requestedUrl;

  const client = new CivicRegistryClient({
    baseUrl: "https://registry.example",
    fetch: async (input) => {
      requestedUrl = String(input);

      return Response.json({
        apiVersion: "1",
        data: {
          registry: {
            id: "registry-one",
            name: "Registry One",
          },
          result: {
            hits: [],
            total: 0,
            page: 2,
            pageSize: 25,
            facets: {
              recordTypes: [],
              statuses: [],
              tags: [],
              fields: {},
            },
          },
        },
      });
    },
  });

  await client.search(
    "registry-one",
    {
      q: "alpha",
      status: [
        "published",
        "archived",
      ],
      page: 2,
    },
  );

  const url = new URL(requestedUrl);

  assert.equal(
    url.searchParams.get("q"),
    "alpha",
  );
  assert.deepEqual(
    url.searchParams.getAll("status"),
    ["published", "archived"],
  );
  assert.equal(
    url.searchParams.get("page"),
    "2",
  );
});

test("SDK exposes structured API errors", async () => {
  const client = new CivicRegistryClient({
    baseUrl: "https://registry.example",
    fetch: async () =>
      Response.json(
        {
          apiVersion: "1",
          error: {
            code: "record_not_found",
            message: "No public record.",
            issues: [
              {
                code: "example_issue",
                message: "Example.",
              },
            ],
          },
        },
        {
          status: 404,
        },
      ),
  });

  await assert.rejects(
    client.getRecord(
      "registry-one",
      "missing",
    ),
    (error) => {
      assert.ok(
        error instanceof
          CivicRegistryApiError,
      );
      assert.equal(
        error.status,
        404,
      );
      assert.equal(
        error.code,
        "record_not_found",
      );
      assert.equal(
        error.issues?.[0].code,
        "example_issue",
      );
      return true;
    },
  );
});

test("SDK export response reads content metadata without manufacturing missing numbers", async () => {
  let call = 0;

  const client = new CivicRegistryClient({
    baseUrl: "https://registry.example",
    fetch: async () => {
      call += 1;

      if (call === 1) {
        return new Response(
          "id,title\r\n1,Example\r\n",
          {
            headers: {
              "Content-Type":
                "text/csv; charset=utf-8",
              "Content-Disposition":
                'attachment; filename="registry.csv"',
              "X-Export-Total": "12",
              "X-Export-Count": "10",
              "X-Export-Truncated": "true",
            },
          },
        );
      }

      return new Response("[]", {
        headers: {
          "Content-Type":
            "application/json",
        },
      });
    },
  });

  const first =
    await client.exportRecords(
      "registry-one",
      {
        format: "csv",
        maxRecords: 10,
      },
    );

  assert.equal(
    first.filename,
    "registry.csv",
  );
  assert.equal(first.total, 12);
  assert.equal(first.exported, 10);
  assert.equal(first.truncated, true);

  const second =
    await client.exportRecords(
      "registry-one",
    );

  assert.equal(second.total, undefined);
  assert.equal(
    second.exported,
    undefined,
  );
  assert.equal(
    second.truncated,
    false,
  );
});
