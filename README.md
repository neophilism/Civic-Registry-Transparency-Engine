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

**PR 13 — Import and ingestion pipelines**

The engine now includes configurable publication lifecycle, immutable history,
disclosure/redaction controls, evidence traceability, relationships, public
search, deadline tracking, and resilient structured ingestion.

PR 13 adds:

- JSON, NDJSON, and CSV decoding;
- source-specific YAML/JSON import profiles kept outside registry policy;
- nested path mapping and schema-aware type coercion;
- stable input/row SHA-256 fingerprints;
- create and idempotent upsert modes;
- safe patch-style updates with explicit full-field replacement;
- lifecycle-safe historical-state bootstrap;
- row-level failure isolation;
- dry-run validation;
- durable ingestion run/item diagnostics;
- immutable record audit linkage to ingestion runs;
- CLI-driven imports and example fixtures.

See [Import and ingestion pipelines](docs/INGESTION.md).

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
