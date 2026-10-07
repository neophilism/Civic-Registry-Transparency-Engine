# Civic Registry & Transparency Engine

Reusable civic infrastructure for searchable public registries, transparency
workflows, statutory deadlines, source documents, APIs, and downstream
applications.

## Purpose

Many civic applications need the same technical primitives:

- structured public records;
- configurable schemas and publication workflows;
- primary-source evidence and document provenance;
- search, relationships, and graph traversal;
- deadlines and notifications;
- immutable revision and audit history;
- structured ingestion and source-refresh orchestration;
- public APIs and bulk exports; and
- an administrator console.

This repository provides those capabilities once.

## Repository boundary

This repository is the **domain-neutral engine**.

It deliberately does not contain a named policy application, agency-specific
registry, surveillance registry, legal-interpretation registry, or other
production use case. Downstream applications belong in their own repositories
and should consume or copy the engine as an upstream foundation.

The only bundled application configuration is
`examples/generic-registry`, a deliberately generic public-document catalog
used for development, documentation, and regression tests.

Provider-specific source adapters, branding, domain schemas, application
workflows, and domain-specific integrations belong downstream.

## Local development

```bash
cp .env.example .env
pnpm install
docker compose up -d db
pnpm dev
```

Then visit `http://localhost:3000`.

Run all quality gates with:

```bash
pnpm ci
```

Seed the generic example with:

```bash
pnpm db:seed-generic
```

See [Development](docs/DEVELOPMENT.md) and
[Architecture](docs/ARCHITECTURE.md) for details.

## Core rule

> No domain-specific concept belongs in the engine core unless it can be
> expressed as a generic capability useful to multiple downstream
> applications.

The repository includes a core-purity regression test so named downstream
applications cannot silently become dependencies of the reusable engine.

## License

A project license has not yet been selected. Do not assume reuse rights beyond
those provided by GitHub or applicable law until a license is added.
