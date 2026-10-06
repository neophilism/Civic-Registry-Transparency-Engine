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

**PR 11 — Disclosure and redaction controls**

The engine now includes configurable publication lifecycle, immutable history,
evidence traceability, relationships, and public search.

PR 11 adds non-destructive disclosure controls with:

- whole-record withholding;
- field-level redaction/withholding;
- safe public record projections;
- separate public-safe search fields/indexes;
- document disclosure and sanitized-artifact references;
- document redaction metadata;
- disclosure-aware relationships, evidence, and history;
- immutable disclosure audit events.

See [Disclosure and redaction](docs/DISCLOSURE-REDACTION.md).

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
