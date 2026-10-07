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

**PR 23 — Structured relationship candidates and legal-authority extraction**

The engine now supports generic machine-proposed relationships with an explicit
human review boundary, and Open Legal Interpretations uses that capability to
propose authority links from page-level primary-source PDF text.

PR 23 adds:

- immutable, evidence-hashed relationship candidates;
- proposal/approval/rejection audit events covered by PR 18 integrity chaining;
- transaction-safe approve/reject materialization;
- direct-SQL review bypass protection;
- concurrent duplicate-relationship protection;
- an administrator relationship-review queue;
- pending-review metrics;
- exact canonical/explicit-alias legal citation matching;
- explicit U.S.C./C.F.R. recognition without unsafe range-membership inference;
- page/document/excerpt provenance for every proposed authority link; and
- source-refresh metrics for candidate and unresolved citation activity.

See [Relationship candidates and authority extraction](docs/RELATIONSHIP-CANDIDATES.md),
[PDF attachment ingestion](docs/PDF-ATTACHMENTS.md), and
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
