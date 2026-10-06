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

**PR 10 — Configurable publication lifecycle**

The engine now includes the reusable foundation completed through PR 9:
schema-driven registries, PostgreSQL persistence, public search, relationships,
source/evidence traceability, and immutable record history.

PR 10 adds configuration-driven publication workflows with:

- named lifecycle states and public-state semantics;
- allowed state transitions;
- generic role requirements;
- approval-gated transitions;
- scheduled publication;
- database-level state-machine enforcement;
- lifecycle-aware public search, lists, relationships, and history.

See [Publication lifecycle](docs/PUBLICATION-LIFECYCLE.md).

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
