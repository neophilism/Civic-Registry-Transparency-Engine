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

**PR 24 — Smart Cities Surveillance Registry**

The engine now powers a second major thin reference application in a very
different civic domain: public surveillance accountability.

PR 24 adds:

- a seven-record-type Smart Cities registry for deployments, technologies,
  agencies, vendors, policies, audits, and reported violations;
- relationships from deployments to technology, agency, vendor supply chains,
  governing policies, audits, and violations;
- public audit, policy-review, and remediation deadlines;
- synthetic source documents and field-level evidence citations;
- a dedicated public presentation with search and accountability metrics;
- public-safe demonstration data that intentionally excludes live operational
  surveillance details;
- a portable Compliance Engine resource-import bundle;
- stable external-reference mapping instead of cross-engine UUID coupling;
- a server-only Compliance Engine registry-projection bridge over the stable
  integration API;
- service-token/HTTPS boundary enforcement and graceful integration failure
  isolation; and
- end-to-end tests for search, relationships, evidence, deadlines, compliance
  mapping, and cryptographic integrity.

See [Smart Cities Surveillance Registry](docs/SMART-CITIES-SURVEILLANCE-REGISTRY.md).

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
