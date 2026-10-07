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

**PR 22 — PDF attachment ingestion and extraction**

The engine now materializes official PDF attachments as durable, versioned
evidence and extracts searchable page-level text.

PR 22 adds:

- `@civic-registry/documents` with a generic document-storage interface;
- content-addressed filesystem storage keyed by SHA-256;
- hardened binary retrieval through the existing safe source client;
- PDF signature validation and text extraction with `pdfjs-dist`;
- persisted extraction text, page text, extractor/version metadata, and hashes;
- generic attachment-to-source/document/citation materialization;
- preservation of changed official files as new immutable document versions;
- Open Legal Interpretations full-text enrichment from retrieved official PDFs;
- scheduled-refresh warning propagation for attachment failures/extraction warnings; and
- offline unit/PostgreSQL tests for storage, extraction, idempotency, versioning,
  evidence linkage, record history, and cryptographic integrity.

See [PDF attachment ingestion](docs/PDF-ATTACHMENTS.md),
[Scheduled source refresh](docs/SOURCE-REFRESH.md), and
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
