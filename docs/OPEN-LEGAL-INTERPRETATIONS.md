# Open Legal Interpretations

PR 19 is the first thin reference application built on the Civic Registry & Transparency Engine.

It demonstrates that a domain-specific public transparency product can be assembled from registry configuration, presentation, import mapping, and fixtures without adding legal-specific concepts to engine packages.

## Purpose

Open Legal Interpretations is designed to publish and explore significant legal interpretations with:

- searchable titles, summaries, holdings, source references, and full text;
- issuing agencies, offices, components, and commissions;
- cited statutes, regulations, cases, constitutional provisions, executive instruments, and other legal authorities;
- supersession and related-opinion relationships;
- source documents and field-level evidence citations;
- publication, withdrawal, supersession, and archive history;
- disclosure, redaction, and whole-record withholding;
- public declassification or release-review deadlines;
- analytics;
- notifications;
- public API/export;
- immutable revisions and audit history; and
- PR 18 cryptographic integrity verification.

## Thin-application boundary

PR 19 does **not** add legal-specific fields, relationships, workflow states, or search behavior to the reusable engine core.

The application consists of:

- `examples/open-legal-interpretations/registry.yaml`
- `examples/open-legal-interpretations/seed.json`
- `examples/open-legal-interpretations/import-profile.yaml`
- `examples/open-legal-interpretations/import.csv`
- `apps/web/app/open-legal-interpretations/page.tsx`
- application-specific tests and documentation.

Everything else is provided by existing generic engine capabilities.

This is the architectural proof the repository was designed to provide: a domain application should remain a small layer rather than becoming a fork of the platform.

## Domain model

### Legal interpretation

Configured fields include:

- title;
- summary;
- interpretation number;
- interpretation type;
- subject;
- issue date;
- public release date;
- issuing body;
- legal authorities;
- key holding;
- searchable interpretation text;
- declassification/release-review due date; and
- source reference.

### Issuing body

Supports:

- agency;
- office;
- component;
- commission; and
- other body types.

Issuing bodies can reference a parent body.

### Legal authority

Supports:

- statute;
- regulation;
- case;
- constitutional provision;
- executive order; and
- other authority types.

## Relationships

The reference application configures:

- `issued-by`
- `interprets-authority`
- `supersedes`
- `related-interpretation`

The generic relationship graph therefore becomes an interpretation lineage and legal-authority graph without changing graph code.

## Publication lifecycle

The configured lifecycle is:

`draft -> under_review -> approved -> published`

with public downstream states for:

- withdrawn;
- superseded; and
- archived.

Review approval uses the engine's existing requester-cannot-approve control.

Scheduled publication uses the existing generic scheduler.

## Disclosure

The app uses the existing disclosure subsystem.

A whole interpretation may be represented by a public placeholder when withheld.

Individual fields may be redacted or withheld.

Source documents may be withheld or redacted independently.

Public reasons and legal authorities for disclosure decisions are enabled.

No separate legal-interpretation redaction implementation exists.

## Declassification / release-review deadlines

The `declassification_review_due` deadline is anchored directly to the configured `declassification_due_on` field.

The deadline is public and uses the generic deadline engine with a 30-day warning horizon.

This is a demonstration of deadline configuration, not a claim that every real legal interpretation is subject to one universal statutory review period. Real deployments should map the applicable rule for each source program.

## Search

The public search index automatically includes configured searchable fields such as:

- title;
- summary;
- interpretation number;
- subject;
- key holding;
- source reference; and
- imported full text.

Configured filterable fields automatically generate facets.

No legal-specific search implementation is required.

## Demonstration data

The included seed and CSV rows are intentionally synthetic.

Names such as **Example Federal Agency**, interpretation numbers beginning with `DEMO-`, and `example.gov` URLs exist only to exercise the application architecture.

They are not representations of actual government legal opinions or agency positions.

This avoids silently mixing invented content with public records.

## Seed locally

After starting PostgreSQL:

```bash
pnpm db:seed-open-legal-interpretations
```

Then visit:

```text
http://localhost:3000/open-legal-interpretations
```

The ordinary generic registry interface remains available at:

```text
http://localhost:3000/registries/open-legal-interpretations
```

The specialized landing page is only a presentation layer over the same installed registry.

## Demonstration import

After seeding:

```bash
pnpm db:ingest-open-legal-interpretations-demo
```

The CSV profile maps source-specific columns into the canonical configured interpretation schema.

The generic ingestion service still performs schema validation, lifecycle protection, idempotent upsert behavior, immutable history, search-index maintenance, deadline reconciliation, and audit linkage.

## Administrator operations

The existing administrator console automatically exposes the reference registry.

Operators can therefore use the same engine screens for:

- schema-driven record creation/editing;
- lifecycle approvals;
- publication;
- deadlines;
- sources;
- ingestion status;
- analytics;
- notifications; and
- audit-integrity verification.

No legal-specific administrator backend is introduced.

## API and SDK

Once the registry is installed, the existing versioned API automatically exposes it.

Examples:

```text
GET /api/v1/registries/open-legal-interpretations
GET /api/v1/registries/open-legal-interpretations/search
GET /api/v1/registries/open-legal-interpretations/records
```

The existing TypeScript SDK and JSON/NDJSON/CSV export features work without application-specific API code.

## Tests

PR 19 includes:

### Configuration tests

They verify that:

- the registry configuration is valid;
- record and relationship types compile;
- deadline/disclosure/notification configuration is active;
- the CSV ingestion profile compiles against the interpretation schema; and
- the specialized page calls generic public-registry/analytics services.

### PostgreSQL end-to-end test

The database test:

1. installs the Open Legal Interpretations config and seed;
2. confirms all records/documents/citations/relationships persist;
3. performs public full-text search;
4. traverses legal-authority and supersession relationships;
5. verifies the configured declassification deadline;
6. resolves public evidence/source documents;
7. imports a CSV interpretation through the generic ingestion service;
8. verifies the imported interpretation is searchable and receives its configured deadline; and
9. verifies the PR 18 cryptographic audit chain remains valid after ingestion.

The engine packages are not modified to special-case the app.

## Public source adapters

PR 20 adds the first live official-source adapters while preserving the same thin-application boundary.

See [Public source adapters](PUBLIC-SOURCE-ADAPTERS.md) for the DOJ OLC and OGE adapters, security model, commands, provenance manifests, and ingestion workflow.

## Next milestone

A subsequent milestone can add scheduled refresh orchestration, attachment/PDF ingestion, structured legal-authority extraction, and adapter health monitoring without changing the canonical registry model.


## Scheduled refresh

PR 21 adds persisted daily refresh jobs for the DOJ OLC and OGE adapters. A recurring worker can poll frequently while PostgreSQL determines which jobs are actually due and prevents overlapping claims.

See [Scheduled source refresh](SOURCE-REFRESH.md) for worker commands, leases, backoff, health states, administrator monitoring, and deployment guidance.


## PDF attachment ingestion

PR 22 extends the scheduled official-source refresh pipeline to retrieve discovered PDF attachments, persist exact content-addressed document versions, extract page-level text, create source/document/citation evidence, and enrich the configured `full_text` field when text is available.

See [PDF attachment ingestion](PDF-ATTACHMENTS.md) for storage, security, extraction, versioning, deployment, failure behavior, and test coverage.

## Next milestone

PR 23 can add structured legal-authority extraction from the trusted full-text/evidence corpus with explicit provenance and review state.


## Structured legal-authority extraction

PR 23 reads the page-level PDF extraction corpus created by PR 22 and proposes reviewable `interprets-authority` relationships when the text explicitly matches a known legal-authority canonical citation or configured alias.

No proposed link becomes canonical automatically.

See [Relationship candidates and authority extraction](RELATIONSHIP-CANDIDATES.md) for the exact-match rules, explicit alias model, provenance evidence, human review queue, audit/integrity behavior, and tests.

## Next milestone

A later milestone can expand legal-authority source ingestion and unresolved-citation triage while preserving the explicit review boundary.
