import assert from "node:assert/strict";
import test from "node:test";

import {
  compileRegistryConfig,
} from "../packages/config/src/index.ts";
import {
  createDatabasePool,
  PostgresRecordRepository,
  PostgresRegistryConfigRepository,
  PostgresRelationshipGraphRepository,
  PostgresRelationshipRepository,
  runMigrations,
} from "../packages/database/src/index.ts";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required for relationship graph integration tests.",
  );
}

const config = {
  schemaVersion: 1,
  registry: {
    id: "graph-test",
    name: "Graph Test",
    recordTypes: [
      {
        id: "node",
        name: "Node",
        pluralName: "Nodes",
        titleFieldId: "name",
        fields: [
          {
            id: "name",
            label: "Name",
            type: "text",
            required: true,
            searchable: true,
          },
        ],
      },
    ],
    relationshipTypes: [
      {
        id: "links-to",
        label: "Links to",
        inverseLabel: "Linked from",
        directed: true,
        fromRecordTypeIds: ["node"],
        toRecordTypeIds: ["node"],
      },
      {
        id: "supports",
        label: "Supports",
        inverseLabel: "Supported by",
        directed: true,
        fromRecordTypeIds: ["node"],
        toRecordTypeIds: ["node"],
      },
    ],
  },
};

const compiled = compileRegistryConfig(config);

function record(id, visibility = "public") {
  return {
    id,
    registryId: "graph-test",
    recordTypeId: "node",
    fields: {
      name: id.toUpperCase(),
    },
    status: "published",
    visibility,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function relationship(
  id,
  type,
  from,
  to,
  minute,
) {
  return {
    id,
    registryId: "graph-test",
    relationshipTypeId: type,
    fromRecordId: from,
    toRecordId: to,
    createdAt: `2026-01-01T00:${String(minute).padStart(2, "0")}:00.000Z`,
  };
}

async function setup() {
  const pool = createDatabasePool({
    connectionString: databaseUrl,
    applicationName: "civic-registry-graph-tests",
  });

  await runMigrations(pool);
  await pool.query(
    "TRUNCATE civic_registry_configurations CASCADE",
  );

  const configs = new PostgresRegistryConfigRepository(pool);
  const records = new PostgresRecordRepository(pool, configs);
  const relationships = new PostgresRelationshipRepository(
    pool,
    configs,
    records,
  );
  const graph =
    new PostgresRelationshipGraphRepository(pool);

  await configs.upsert(config);

  for (const item of [
    record("a"),
    record("b"),
    record("c"),
    record("d"),
    record("x", "private"),
  ]) {
    await records.create(item);
  }

  for (const item of [
    relationship("ab", "links-to", "a", "b", 1),
    relationship("bc", "links-to", "b", "c", 2),
    relationship("ca", "links-to", "c", "a", 3),
    relationship("cd", "supports", "c", "d", 4),
    relationship("bx", "links-to", "b", "x", 5),
  ]) {
    await relationships.create(item);
  }

  return {
    pool,
    graph,
  };
}

test("graph traversal is depth-limited, cycle-safe, and visibility-aware", async () => {
  const { pool, graph } = await setup();

  try {
    const oneHop = await graph.getGraph({
      registryId: compiled.definition.id,
      rootRecordId: "a",
      depth: 1,
      visibility: "public",
    });

    assert.ok(oneHop);
    assert.deepEqual(
      new Set(oneHop.nodes.map((node) => node.record.id)),
      new Set(["a", "b", "c"]),
    );
    assert.deepEqual(
      new Set(oneHop.edges.map((edge) => edge.id)),
      new Set(["ab", "ca"]),
    );

    const twoHops = await graph.getGraph({
      registryId: compiled.definition.id,
      rootRecordId: "a",
      depth: 2,
      visibility: "public",
    });

    assert.ok(twoHops);
    assert.deepEqual(
      new Set(twoHops.nodes.map((node) => node.record.id)),
      new Set(["a", "b", "c", "d"]),
    );
    assert.ok(
      twoHops.edges.some((edge) => edge.id === "bc"),
    );
    assert.ok(
      twoHops.edges.some((edge) => edge.id === "cd"),
    );
    assert.ok(
      !twoHops.nodes.some(
        (node) => node.record.id === "x",
      ),
    );

    const distances = new Map(
      twoHops.nodes.map((node) => [
        node.record.id,
        node.distance,
      ]),
    );
    assert.equal(distances.get("a"), 0);
    assert.equal(distances.get("b"), 1);
    assert.equal(distances.get("c"), 1);
    assert.equal(distances.get("d"), 2);
  } finally {
    await pool.end();
  }
});

test("graph traversal supports type and storage-direction constraints", async () => {
  const { pool, graph } = await setup();

  try {
    const linksOnly = await graph.getGraph({
      registryId: "graph-test",
      rootRecordId: "a",
      depth: 3,
      relationshipTypeIds: ["links-to"],
      visibility: "public",
    });

    assert.ok(linksOnly);
    assert.ok(
      !linksOnly.edges.some(
        (edge) => edge.relationshipTypeId === "supports",
      ),
    );
    assert.ok(
      !linksOnly.nodes.some(
        (node) => node.record.id === "d",
      ),
    );

    const outbound = await graph.getGraph({
      registryId: "graph-test",
      rootRecordId: "a",
      depth: 1,
      direction: "outbound",
      visibility: "public",
    });

    assert.ok(outbound);
    assert.deepEqual(
      new Set(outbound.nodes.map((node) => node.record.id)),
      new Set(["a", "b"]),
    );
    assert.deepEqual(
      outbound.edges.map((edge) => edge.id),
      ["ab"],
    );

    const inbound = await graph.getGraph({
      registryId: "graph-test",
      rootRecordId: "a",
      depth: 1,
      direction: "inbound",
      visibility: "public",
    });

    assert.ok(inbound);
    assert.deepEqual(
      new Set(inbound.nodes.map((node) => node.record.id)),
      new Set(["a", "c"]),
    );
    assert.deepEqual(
      inbound.edges.map((edge) => edge.id),
      ["ca"],
    );
  } finally {
    await pool.end();
  }
});

test("graph traversal enforces node caps and hides non-public roots", async () => {
  const { pool, graph } = await setup();

  try {
    const capped = await graph.getGraph({
      registryId: "graph-test",
      rootRecordId: "a",
      depth: 3,
      visibility: "public",
      maxNodes: 2,
    });

    assert.ok(capped);
    assert.ok(capped.nodes.length <= 2);
    assert.equal(capped.truncated, true);

    const privateRoot = await graph.getGraph({
      registryId: "graph-test",
      rootRecordId: "x",
      depth: 1,
      visibility: "public",
    });

    assert.equal(privateRoot, null);
  } finally {
    await pool.end();
  }
});


test("graph traversal does not cross hidden withheld records", async () => {
  const { pool, graph } = await setup();

  try {
    await pool.query(
      `
        INSERT INTO civic_registry_record_disclosures (
          registry_id,
          record_id,
          disposition,
          updated_at
        )
        VALUES ($1, 'b', 'withheld', NOW())
      `,
      [compiled.definition.id],
    );

    const result = await graph.getGraph({
      registryId: compiled.definition.id,
      rootRecordId: "a",
      depth: 3,
      direction: "outbound",
      visibility: "public",
      excludeWithheld: true,
    });

    assert.ok(result);
    assert.deepEqual(
      result.nodes.map((node) => node.record.id),
      ["a"],
    );
    assert.deepEqual(result.edges, []);
  } finally {
    await pool.end();
  }
});
