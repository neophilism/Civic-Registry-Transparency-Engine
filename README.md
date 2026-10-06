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

**PR 18 — Cryptographic audit integrity**

The engine now adds cryptographic tamper evidence on top of the database-enforced
immutable history introduced in PR 9.

PR 18 adds:

- a registry-wide SHA-256 chain over record revisions and audit events;
- deterministic PR-18 baseline commitments for existing immutable history;
- registry-scoped serialized append ordering;
- independent chain/source verification;
- protected integrity-ledger and chain-head storage;
- Ed25519-signed external checkpoints;
- optional signed SHA-256 binding of physical backup files;
- CLI verification/checkpoint tooling; and
- a restricted administrator integrity dashboard.

See [Cryptographic audit integrity](docs/AUDIT-INTEGRITY.md).

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
