# Architecture

## Purpose

The Civic Registry & Transparency Engine is upstream infrastructure for many
independent public-interest applications. A downstream registry should mainly
supply configuration, schemas, ingestion adapters, terminology, branding, and
specialized presentation rather than duplicating infrastructure.

## Architectural rules

1. **The engine is domain neutral.** Named applications and policy-specific
   concepts live in separate downstream repositories.
2. **Primary sources are first-class.** Public claims can be traced to source
   documents or authoritative external records when configured.
3. **Published changes are auditable.** Applications can preserve meaningful
   record history instead of silently rewriting public records.
4. **Public data is portable.** Search, APIs, and bulk exports are platform
   responsibilities.
5. **Specialized infrastructure stays replaceable.** Search, object storage,
   persistence, queues, and notifications sit behind interfaces where
   practical.
6. **Configuration before duplication.** Capabilities needed by multiple
   applications should move upstream.
7. **No upstream dependency on downstream code.** Packages and the reference
   web application may not import a named downstream application.

## Repository structure

```text
apps/
  web/                 Generic public/admin reference application

packages/
  core/                Generic domain primitives
  database/            Persistence, migrations, audit and operations
  registry/            Public record presentation helpers
  search/              Search provider abstraction
  documents/           Sources, files, citations and PDF extraction
  deadlines/           Configurable clocks and reminders
  api/                 Shared public API contracts
  config/              Schema/config loading and validation
  ingestion/           Provider-neutral structured ingestion
  source-adapters/     Safe public-source retrieval primitives
  sdk/                 External TypeScript client

examples/
  generic-registry/    Deliberately generic development/test configuration
```

## Technology choices

- TypeScript
- Next.js
- PostgreSQL
- pnpm workspaces
- PostgreSQL search initially, behind a provider abstraction
- content-addressed document storage behind a replaceable interface

## Downstream application boundary

A downstream repository may contain:

- domain-specific registry schemas and terminology;
- application-specific lifecycle or status policy;
- provider-specific source adapters and refresh-job definitions;
- branding and presentation overrides;
- application-specific external integrations; and
- genuinely specialized behavior.

A downstream repository should reuse rather than reimplement:

- canonical record storage;
- schema validation;
- search;
- relationship graphs;
- publication lifecycle;
- disclosure/redaction;
- evidence and document storage;
- deadline calculation;
- notifications;
- immutable history and integrity checks;
- ingestion orchestration;
- source-refresh leasing/health;
- public APIs and exports; and
- the administrator console.

## Upstream/downstream evolution

If a downstream application needs a capability that is broadly reusable, the
capability should be generalized and contributed upstream without bringing the
application's nouns, provider assumptions, fixtures, or presentation into this
repository.

The generic example exists only to prove that the engine can operate without
custom application code. It is not a production use case.
