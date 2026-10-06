# Typed relationships and graph traversal

PR 7 turns relationships from a stored domain primitive into a reusable public
browsing and graph capability.

## Relationship semantics

Each configured relationship type may define:

```yaml
relationshipTypes:
  - id: published-by
    label: Published by
    inverseLabel: Published
    directed: true
```

For a directed relationship:

```text
Document --Published by--> Organization
Document <--Published----- Organization
```

The label shown to a user therefore depends on which endpoint is the current
root record.

For an undirected relationship:

```yaml
  - id: related-to
    label: Related to
    directed: false
```

the same semantic label is used from either endpoint.

## Stored direction versus semantic direction

Every relationship row stores a `from_record_id` and `to_record_id` because
stable endpoints are required for persistence and traversal.

That storage orientation does not necessarily mean the relationship is
semantically directed. The configured `directed` flag controls presentation.

The registry presentation package exposes:

- `outbound`;
- `inbound`;
- `undirected`.

It also applies `inverseLabel` automatically for inbound directed
relationships.

## Bounded graph traversal

`PostgresRelationshipGraphRepository` traverses stored relationships in
bounded breadth-first layers.

The public graph interface allows one, two, or three hops.

Traversal is constrained by:

- registry;
- root record;
- optional relationship types;
- optional stored endpoint direction;
- optional visibility;
- node cap.

The public application always traverses with:

```text
visibility = public
```

so a public edge is never returned when either endpoint is non-public.

## Cycle handling

Traversal tracks previously discovered record IDs. Cycles may still appear as
edges because they are meaningful relationships, but nodes are not repeatedly
expanded.

This permits networks such as:

```text
A -> B -> C -> A
```

without unbounded traversal.

## Node caps

The database repository supports a configurable node cap up to 250.

The public relationship map uses a 100-node cap. When the cap is reached the
response reports `truncated: true` and the interface asks the user to reduce
depth or filter by relationship type.

## Public routes

The reference application exposes:

```text
/registries/:registryId/records/:recordId/relationships
/registries/:registryId/records/:recordId/graph
```

The relationship browser supports:

- relationship type;
- semantic direction.

The map supports:

- one to three hops;
- relationship type.

## Public JSON APIs

```text
GET /api/registries/:registryId/records/:recordId/relationships
GET /api/registries/:registryId/records/:recordId/graph
```

Relationship endpoint query parameters:

- `type`;
- `direction=outbound|inbound|undirected`.

Graph endpoint query parameters:

- `type`;
- `depth=1|2|3`.

Both APIs enforce the same public-visibility boundary as the HTML interface.

## No graph database requirement

PR 7 intentionally does not introduce Neo4j or another graph database.

The current relationship model and endpoint indexes are sufficient for bounded
public exploration. If a future downstream application requires deep or
large-scale graph analytics, a provider boundary can be introduced without
changing the configured relationship vocabulary.
