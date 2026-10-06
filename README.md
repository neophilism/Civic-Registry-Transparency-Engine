# Civic Registry & Transparency Engine

Reusable civic infrastructure for searchable public registries, transparency
workflows, statutory deadlines, source documents, APIs, and downstream
legislative applications.

## Why this repository exists

Many civic and legislative applications need the same technical primitives:
structured public records, primary-source documents, search, relationships,
publication workflows, deadline tracking, auditable history, APIs, and exports.

This repository provides those capabilities once. Downstream applications
should be thin layers composed from the engine rather than long-lived forks
that duplicate core logic.

## Current milestone

**PR 15 — Administrator console**

The engine now includes a restricted, domain-neutral operator console for
managing canonical registry data and operational workflows without weakening
the public disclosure boundary.

PR 15 adds:

- authenticated `/admin` access with explicit operator identity;
- cross-registry operational summaries;
- schema-driven record creation and editing;
- publication lifecycle requests and approval decisions;
- deadline monitoring, reconciliation, and state actions;
- ingestion-run and item-level failure visibility;
- source management;
- immutable history and audit inspection;
- installed configuration validation;
- database-backed audit attribution for administrative record writes.

See [Administrator console](docs/ADMIN-CONSOLE.md).

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

See [Development](docs/DEVELOPMENT.md) and
[Architecture](docs/ARCHITECTURE.md) for details.

## Core rule

> No bill-specific concept belongs in the engine core unless it can be expressed
> as a generic capability useful to multiple downstream applications.

## License

A project license has not yet been selected. Do not assume reuse rights beyond
those provided by GitHub or applicable law until a license is added.
