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

**PR 21 — Scheduled source refresh and health monitoring**

The engine now has database-backed recurring source refresh orchestration around
the public-source adapters introduced in PR 20.

PR 21 adds:

- persisted refresh job definitions and run history;
- PostgreSQL worker leases with `FOR UPDATE SKIP LOCKED`;
- safe concurrent polling by multiple workers;
- expired-lease recovery and stale-worker protection;
- exponential failure backoff;
- empty-result and row-count regression monitoring;
- adapter-run to ingestion-run linkage;
- reusable healthy/warning/failing/stale status computation;
- an administrator source-refresh health dashboard;
- queue/enable/disable operator controls that never fetch from the web process;
- thin-app daily OLC and OGE refresh definitions; and
- PostgreSQL concurrency tests proving duplicate workers cannot claim the same job.

See [Scheduled source refresh](docs/SOURCE-REFRESH.md),
[Public source adapters](docs/PUBLIC-SOURCE-ADAPTERS.md), and
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
