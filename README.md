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

**PR 20 — Public source adapters**

The engine now has a hardened, provider-neutral source-adapter boundary plus the
first real official-source adapters for Open Legal Interpretations.

PR 20 adds:

- `@civic-registry/source-adapters` for safe HTTPS retrieval and deterministic normalization;
- per-adapter host allowlists with DNS private/reserved-address rejection;
- redirect revalidation, response-size limits, and request timeouts;
- deterministic NDJSON output and SHA-256 run manifests;
- a DOJ Office of Legal Counsel opinion adapter;
- a U.S. Office of Government Ethics Legal Advisory adapter;
- a dedicated adapter-to-registry ingestion profile;
- official OLC and OGE issuing-body records;
- offline structural parser/security tests; and
- PostgreSQL proof that adapter output flows through ordinary ingestion and
  remains covered by immutable history and cryptographic integrity.

The external-source boundary stays separate from database writes: adapters fetch
and normalize; the existing ingestion service validates and persists.

See [Public source adapters](docs/PUBLIC-SOURCE-ADAPTERS.md) and
[Open Legal Interpretations](docs/OPEN-LEGAL-INTERPRETATIONS.md).

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
