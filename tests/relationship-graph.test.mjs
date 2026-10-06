import assert from "node:assert/strict";
import test from "node:test";

import {
  compileRegistryConfig,
} from "../packages/config/src/index.ts";
import {
  groupPresentedRelationships,
  presentRelationship,
  presentRelationshipGraph,
  relationshipDirection,
  relationshipDirectionLabel,
} from "../packages/registry/src/index.ts";

const registry = compileRegistryConfig({
  schemaVersion: 1,
  registry: {
    id: "relationship-test",
    name: "Relationship Test",
    recordTypes: [
      {
        id: "item",
        name: "Item",
        pluralName: "Items",
        titleFieldId: "name",
        fields: [
          {
            id: "name",
            label: "Name",
            type: "text",
            required: true,
          },
        ],
      },
    ],
    relationshipTypes: [
      {
        id: "owns",
        label: "Owns",
        inverseLabel: "Owned by",
        directed: true,
      },
      {
        id: "related-to",
        label: "Related to",
        directed: false,
      },
    ],
  },
});

function record(id, name) {
  return {
    id,
    registryId: "relationship-test",
    recordTypeId: "item",
    fields: { name },
    status: "published",
    visibility: "public",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const owner = record("owner", "Owner");
const asset = record("asset", "Asset");

const directed = {
  id: "owns-1",
  registryId: "relationship-test",
  relationshipTypeId: "owns",
  fromRecordId: "owner",
  toRecordId: "asset",
  createdAt: "2026-01-01T01:00:00.000Z",
  metadata: {},
};

const undirected = {
  id: "related-1",
  registryId: "relationship-test",
  relationshipTypeId: "related-to",
  fromRecordId: "owner",
  toRecordId: "asset",
  createdAt: "2026-01-01T02:00:00.000Z",
  metadata: {},
};

test("directed relationships expose outbound and inverse labels", () => {
  const type = registry.relationshipTypesById.get("owns");

  assert.equal(
    relationshipDirection("owner", directed, type),
    "outbound",
  );
  assert.equal(
    relationshipDirectionLabel("owner", directed, type),
    "Owns",
  );
  assert.equal(
    relationshipDirection("asset", directed, type),
    "inbound",
  );
  assert.equal(
    relationshipDirectionLabel("asset", directed, type),
    "Owned by",
  );
});

test("undirected relationships use one label from either endpoint", () => {
  const type =
    registry.relationshipTypesById.get("related-to");

  assert.equal(
    relationshipDirection("owner", undirected, type),
    "undirected",
  );
  assert.equal(
    relationshipDirection("asset", undirected, type),
    "undirected",
  );
  assert.equal(
    relationshipDirectionLabel("asset", undirected, type),
    "Related to",
  );
});

test("relationship presentation and grouping preserve semantic direction", () => {
  const outbound = presentRelationship(
    "owner",
    directed,
    asset,
    registry,
  );
  const undirectedPresented = presentRelationship(
    "owner",
    undirected,
    asset,
    registry,
  );

  assert.equal(outbound.directionLabel, "Owns");
  assert.equal(outbound.relatedRecord.title, "Asset");
  assert.equal(undirectedPresented.directed, false);

  const groups = groupPresentedRelationships([
    outbound,
    undirectedPresented,
  ]);

  assert.equal(groups.length, 2);
  assert.deepEqual(
    new Set(groups.map((group) => group.label)),
    new Set(["Owns", "Related to"]),
  );
});

test("graph presentation exposes distances and configured edge semantics", () => {
  const graph = presentRelationshipGraph(
    {
      rootRecordId: "owner",
      nodes: [
        { record: owner, distance: 0 },
        { record: asset, distance: 1 },
      ],
      edges: [directed, undirected],
    },
    registry,
  );

  assert.equal(graph.rootRecordId, "owner");
  assert.equal(graph.maxDistance, 1);
  assert.equal(
    graph.nodes.find((node) => node.id === "owner")?.root,
    true,
  );
  assert.equal(graph.edges[0].label, "Owns");
  assert.equal(graph.edges[0].directed, true);
  assert.equal(graph.edges[1].directed, false);
});
