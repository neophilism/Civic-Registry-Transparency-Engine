# Architecture

## Purpose

The Civic Registry & Transparency Engine is an upstream platform for multiple
public-interest applications. A new registry should primarily require
configuration, schemas, ingestion adapters, terminology, and presentation—not
duplicated infrastructure.

## Architectural rules

1. **No bill-specific concepts in the engine core.** Downstream applications may
   define legal interpretations, surveillance technologies, algorithms, federal
   programs, or other domain records. The core understands generic registry
   primitives.
2. **Primary sources are first-class.** Public claims should be traceable to
   source documents or authoritative external records when configured.
3. **Published changes are auditable.** Downstream applications must be able to
   preserve meaningful record history instead of silently rewriting public
   records.
4. **Public data is portable.** Search, APIs, and bulk exports are platform
   responsibilities.
5. **Specialized infrastructure stays replaceable.** Search, object storage,
   persistence, queues, and notifications should sit behind interfaces where
   practical.
6. **Configuration before duplication.** Features needed by more than one
   downstream application should move upstream.

## Planned structure

```text
apps/
  web/                 Reference public application

packages/
  core/                Generic domain primitives
  database/            Persistence and migrations
  registry/            Records, record types, fields, relationships
  search/              Search provider abstraction
  documents/           Sources, files, citations
  deadlines/           Configurable clocks and reminders
  audit/               Immutable event/revision history
  api/                 Shared API contracts
  ui/                  Reusable interface components
  config/              Schema/config loading and validation
  sdk/                 External TypeScript client
```

## Initial technology choices

- TypeScript
- Next.js for the reference web application
- PostgreSQL for canonical relational storage
- pnpm workspaces
- PostgreSQL search initially, behind a provider abstraction
- Object storage behind a future storage adapter

## Application boundary

Downstream applications should contain:

- registry schemas;
- terminology;
- policy/status rules;
- application-specific ingestion adapters;
- branding and presentation overrides;
- genuinely specialized behavior.

They should not reimplement generic search, record storage, audit history,
deadlines, documents, exports, or registry APIs.
