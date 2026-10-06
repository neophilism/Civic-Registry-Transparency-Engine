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

**PR 19 — Open Legal Interpretations reference application**

The first thin domain application now runs on the reusable engine without adding
legal-specific concepts to core packages.

PR 19 adds:

- a complete Open Legal Interpretations registry configuration;
- legal-interpretation, issuing-body, and legal-authority record schemas;
- authority, issuing-body, supersession, and related-opinion relationships;
- publication/withdrawal/supersession lifecycle configuration;
- disclosure/redaction behavior;
- public declassification/release-review deadlines;
- synthetic source/document/evidence fixtures;
- a CSV ingestion profile and fixture;
- a dedicated public reference-app landing page;
- one-command seed/import scripts; and
- PostgreSQL end-to-end proof that search, relationships, deadlines, evidence,
  and cryptographic integrity work through existing engine primitives.

All included interpretation data is explicitly synthetic demonstration data.

See [Open Legal Interpretations](docs/OPEN-LEGAL-INTERPRETATIONS.md).

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
