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
