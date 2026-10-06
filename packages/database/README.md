# @civic-registry/database

PostgreSQL persistence for the Civic Registry & Transparency Engine.

## Design

The database schema is intentionally generic. A new downstream registry does
not create bill-specific tables or database migrations.

Registry definitions are stored as validated JSONB configuration. Records use
shared relational columns for operational metadata and a JSONB `fields`
payload for configured domain fields. Relationships are stored in a typed
generic relationship table.

This provides relational integrity without requiring schema migrations every
time a downstream application introduces a new record type.

## Tables

PR 4 creates:

- `civic_registry_schema_migrations`
- `civic_registry_configurations`
- `civic_registry_records`
- `civic_registry_relationships`

Future milestones add specialized tables only when a genuinely shared engine
capability requires them.

## Migration safety

Migration files:

- use ordered `NNNN_description.sql` names;
- are checksummed when applied;
- cannot be silently modified after application;
- run under a PostgreSQL advisory lock;
- run transactionally one migration at a time.

## Repositories

The package exposes interfaces plus PostgreSQL implementations for:

- registry configuration CRUD;
- record CRUD and filtered listing;
- relationship create/get/list/delete.

Record writes are validated against the stored registry configuration before
SQL executes. Relationship writes validate the configured relationship type,
source record type, target record type, and endpoint existence.

## Commands

Apply migrations:

```bash
pnpm db:migrate
```

Seed the generic example:

```bash
pnpm db:seed -- \
  examples/generic-registry/registry.yaml \
  examples/generic-registry/seed.json
```

Seed operations are idempotent for the same IDs: existing records are updated
and existing relationships are replaced.


## Search provider

The database package also contains the default `PostgresSearchProvider`.
Search behavior is defined by the provider-neutral `@civic-registry/search`
contract.

PostgreSQL stores engine-generated searchable text separately from the
configured JSONB record payload and maintains a GIN-indexed generated
`tsvector`.

After upgrading an existing database to the search migration, run:

```bash
pnpm db:reindex
```

New creates and updates maintain their index text automatically.


## Relationship graph traversal

`PostgresRelationshipGraphRepository` provides bounded graph traversal without
requiring a separate graph database.

Traversal supports:

- one to three hops;
- relationship-type filters;
- inbound, outbound, or either stored endpoint direction;
- visibility constraints;
- node caps;
- cycle-safe expansion.

The default public web layer always supplies `visibility: public`.

Traversal uses the existing relationship endpoint indexes, so PR 7 does not
require a new database migration.


## Evidence traceability

The database package includes repositories for sources, documents, and
citations.

Evidence objects are registry-scoped and visibility-aware. Citation writes
validate configured record fields, evidence targets, document page bounds, and
public/private provenance consistency.

Migration `0003_evidence_traceability.sql` creates the shared evidence
tables. Downstream registries do not need bill-specific evidence tables.


## Immutable revision history

Migration `0004_immutable_revision_history.sql` adds database-triggered record
snapshots and generic audit events.

Meaningful record changes are versioned even when issued through direct SQL.
Internal search-index-only updates are ignored.

History tables reject normal row updates and deletes. Record deletion does not
erase that record's version snapshots.

Relationship and evidence citation mutations also emit record audit events.
Existing records, relationships, and citations are introduced to the history
system with explicit baseline events instead of fabricated creation events.

The read-side `PostgresRecordHistoryRepository` provides visibility-aware
version and event queries.


## Publication lifecycle

Migration `0005_publication_lifecycle.sql` adds durable transition requests,
approval decisions, publication schedules, and a PostgreSQL state-machine
guard.

Normal record creation must begin at the configured lifecycle
`initialStatusId`. Seed/import code may explicitly use
`bootstrapLifecycle: true` for pre-existing records.

Status updates for lifecycle-managed registries must use
`PostgresPublicationLifecycleService`. The database independently verifies
that the state transition exists and rejects ordinary direct SQL status
changes.

The lifecycle service supports:

- role-gated transitions;
- approval thresholds;
- requester self-approval restrictions;
- scheduled publication;
- schedule cancellation;
- due-schedule processing;
- audit-event emission.

Run due schedules with:

```bash
pnpm db:publish-due
```
