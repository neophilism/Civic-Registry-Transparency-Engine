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

**PR 14 — Public API, TypeScript SDK & exports**

The engine now exposes a stable read-only integration surface on top of the
same lifecycle, disclosure, search, evidence, history, relationship, and
deadline boundaries used by the public site.

PR 14 adds:

- versioned `/api/v1` public endpoints;
- consistent JSON envelopes and machine-readable errors;
- read-only cross-origin access;
- public registry metadata;
- record/search/evidence/history/relationship/graph/deadline endpoints;
- OpenAPI 3.1;
- reusable `@civic-registry/api` contracts;
- reusable `@civic-registry/sdk` TypeScript client;
- JSON, NDJSON, and CSV exports;
- multi-page export collection with explicit truncation metadata;
- spreadsheet-formula protection for CSV exports;
- integration tests proving redacted canonical values do not leak through the
  API or exports.

See [Public API, SDK, and exports](docs/PUBLIC-API.md).

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
