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

**PR 17 — Notifications and subscriptions**

The engine now includes durable, configuration-driven event subscriptions and
delivery processing without weakening the public disclosure boundary.

PR 17 adds:

- record publication/change and new-matching-record events;
- approaching and missed deadline events;
- document-added events;
- public-scope and internal-scope subscriptions;
- email, signed webhook, and persistent internal notification channels;
- generic record type, record id, lifecycle status, and tag filters;
- durable event/delivery deduplication;
- leased delivery processing with retry/backoff;
- webhook SSRF protections and HMAC signatures;
- provider-neutral HTTP email relay integration;
- administrator subscription management and internal inbox; and
- a schedulable notification runner.

See [Notifications and subscriptions](docs/NOTIFICATIONS.md).

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
