# PostgreSQL persistence

PR 4 adds the first durable persistence implementation.

## Persistence boundary

The engine separates:

```text
domain/configuration
        ↓
repository interfaces
        ↓
PostgreSQL repositories
        ↓
shared generic schema
```

Downstream applications depend on repository behavior rather than embedding SQL
throughout application logic.

## Why records use JSONB

Configured registries can differ dramatically. One application may describe
legal interpretations; another may describe surveillance technologies; another
may describe federal programs.

Creating database tables for each downstream schema would defeat the purpose of
a reusable engine. Instead:

- stable operational metadata remains relational;
- configurable record fields live in JSONB;
- common filters have relational indexes;
- JSONB and tags receive GIN indexes;
- domain validation occurs before persistence.

Later search work can add indexes or dedicated search infrastructure without
changing the downstream configuration model.

## Referential integrity

Records belong to a stored registry configuration.

Relationships use composite foreign keys so both endpoints must exist in the
same registry. Deleting a record cascades relationships attached to that record.
Deleting a registry configuration cascades its records and relationships.

The repository layer additionally validates configured relationship direction
and allowed source/target record types.

## Repository interfaces

The package defines interfaces separately from PostgreSQL implementations. This
keeps application code from depending directly on `pg` or SQL.

The initial repositories cover:

- registry configuration CRUD;
- record CRUD;
- filtered record listing;
- relationship create/get/list/delete.

## Migration rules

Migration IDs are permanent. Once a migration has been applied, its checksum
must not change.

To change the schema, create a new migration rather than editing an applied
migration.

Migrations are serialized using a PostgreSQL advisory lock and each migration
runs inside its own transaction.

## Seeds

Seed files contain full engine records and relationships. Seeding first stores
the registry configuration, then creates or updates records, then creates or
replaces relationships.

This is intended for examples, demonstrations, test environments, and initial
public-data imports. Bulk ingestion will receive its own pipeline in PR 13.
