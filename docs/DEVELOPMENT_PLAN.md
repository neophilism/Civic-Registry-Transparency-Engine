# Civic Registry & Transparency Engine — recovered complete development plan

**Provenance:** Original October 5 original 22-PR generic registry plan; October 6-7 separate core-cleanup and public source ingestion decisions. **22 original milestone titles recovered**, mapped in original order. Scopes and acceptance criteria below are a careful synthesis of the original conversations and existing repository architecture; they are **not** a verbatim export of the old chat. This is the historical approved scope plus explicit subsequent amendments, not a declaration that unmerged tasks are complete.

## Purpose / product boundary

Reusable, domain-neutral registry and transparency infrastructure for configurable record types, relationships, evidence, source citations, version histories, lawful publication/redaction, deadlines and imports. Bill-specific registries are thin downstream applications; do not hardwire Smart Cities, Open Legal Interpretations, or Sam Ervin into the engine.

## Original milestone-by-milestone plan

### CRT-01 — Repository foundation

- **Scope:** TypeScript monorepo, documented architectural contracts, test/CI, local Postgres and repeatable development.
- **Dependencies:** None
- **Acceptance:** Tests must cover normal authorized operation, invalid inputs, cross-role/tenant access denial, audit/provenance preservation, retries/duplicates where applicable, and at least one documented failure/recovery case. UI milestones require keyboard and screen reader checks. Never equate mocked fixture or document with real-world ingestion, compliance, or production.

### CRT-02 — Core domain model

- **Scope:** Generic record, record type, organization, person, version, reference, source, relationship, attachment and publication entities.
- **Dependencies:** Prior data model, APIs, state transitions or provider integrations on which the feature depends; verify concrete dependency against current source.
- **Acceptance:** Tests must cover normal authorized operation, invalid inputs, cross-role/tenant access denial, audit/provenance preservation, retries/duplicates where applicable, and at least one documented failure/recovery case. UI milestones require keyboard and screen reader checks. Never equate mocked fixture or document with real-world ingestion, compliance, or production.

### CRT-03 — Configuration system

- **Scope:** Schema-driven record definitions, view fields, validation and versioned downstream configurations.
- **Dependencies:** Prior data model, APIs, state transitions or provider integrations on which the feature depends; verify concrete dependency against current source.
- **Acceptance:** Tests must cover normal authorized operation, invalid inputs, cross-role/tenant access denial, audit/provenance preservation, retries/duplicates where applicable, and at least one documented failure/recovery case. UI milestones require keyboard and screen reader checks. Never equate mocked fixture or document with real-world ingestion, compliance, or production.

### CRT-04 — Database and migrations

- **Scope:** Reusable Postgres persistence, indexes, data migrations, seeds and per-tenant/record scope boundaries.
- **Dependencies:** Prior data model, APIs, state transitions or provider integrations on which the feature depends; verify concrete dependency against current source.
- **Acceptance:** Tests must cover normal authorized operation, invalid inputs, cross-role/tenant access denial, audit/provenance preservation, retries/duplicates where applicable, and at least one documented failure/recovery case. UI milestones require keyboard and screen reader checks. Never equate mocked fixture or document with real-world ingestion, compliance, or production.

### CRT-05 — Public registry UI

- **Scope:** Accessible record browsing, detail pages, citations, canonical IDs and page-state handling.
- **Dependencies:** Prior data model, APIs, state transitions or provider integrations on which the feature depends; verify concrete dependency against current source.
- **Acceptance:** Tests must cover normal authorized operation, invalid inputs, cross-role/tenant access denial, audit/provenance preservation, retries/duplicates where applicable, and at least one documented failure/recovery case. UI milestones require keyboard and screen reader checks. Never equate mocked fixture or document with real-world ingestion, compliance, or production.

### CRT-06 — Search and filter engine

- **Scope:** Full-text/trigram search, generic structured filters, pagination and stable public URLs.
- **Dependencies:** Prior data model, APIs, state transitions or provider integrations on which the feature depends; verify concrete dependency against current source.
- **Acceptance:** Tests must cover normal authorized operation, invalid inputs, cross-role/tenant access denial, audit/provenance preservation, retries/duplicates where applicable, and at least one documented failure/recovery case. UI milestones require keyboard and screen reader checks. Never equate mocked fixture or document with real-world ingestion, compliance, or production.

### CRT-07 — Relationships

- **Scope:** Typed, evidenced inter-record links, confidence/provenance and graph traversal.
- **Dependencies:** Prior data model, APIs, state transitions or provider integrations on which the feature depends; verify concrete dependency against current source.
- **Acceptance:** Tests must cover normal authorized operation, invalid inputs, cross-role/tenant access denial, audit/provenance preservation, retries/duplicates where applicable, and at least one documented failure/recovery case. UI milestones require keyboard and screen reader checks. Never equate mocked fixture or document with real-world ingestion, compliance, or production.

### CRT-08 — Documents and citations

- **Scope:** Controlled evidence intake, hashes, citation references, source URLs and sanitized document viewers.
- **Dependencies:** Prior data model, APIs, state transitions or provider integrations on which the feature depends; verify concrete dependency against current source.
- **Acceptance:** Tests must cover normal authorized operation, invalid inputs, cross-role/tenant access denial, audit/provenance preservation, retries/duplicates where applicable, and at least one documented failure/recovery case. UI milestones require keyboard and screen reader checks. Never equate mocked fixture or document with real-world ingestion, compliance, or production.

### CRT-09 — Version history

- **Scope:** Append-only version lineage, source and editor attribution, diff and correction display.
- **Dependencies:** Prior data model, APIs, state transitions or provider integrations on which the feature depends; verify concrete dependency against current source.
- **Acceptance:** Tests must cover normal authorized operation, invalid inputs, cross-role/tenant access denial, audit/provenance preservation, retries/duplicates where applicable, and at least one documented failure/recovery case. UI milestones require keyboard and screen reader checks. Never equate mocked fixture or document with real-world ingestion, compliance, or production.

### CRT-10 — Publication workflow

- **Scope:** Draft/review/approved/published/withdrawn states with separation of duties.
- **Dependencies:** Prior data model, APIs, state transitions or provider integrations on which the feature depends; verify concrete dependency against current source.
- **Acceptance:** Tests must cover normal authorized operation, invalid inputs, cross-role/tenant access denial, audit/provenance preservation, retries/duplicates where applicable, and at least one documented failure/recovery case. UI milestones require keyboard and screen reader checks. Never equate mocked fixture or document with real-world ingestion, compliance, or production.

### CRT-11 — Redactions

- **Scope:** Field/document-level disclosure policies with public-safe projections and immutable redaction history.
- **Dependencies:** Prior data model, APIs, state transitions or provider integrations on which the feature depends; verify concrete dependency against current source.
- **Acceptance:** Tests must cover normal authorized operation, invalid inputs, cross-role/tenant access denial, audit/provenance preservation, retries/duplicates where applicable, and at least one documented failure/recovery case. UI milestones require keyboard and screen reader checks. Never equate mocked fixture or document with real-world ingestion, compliance, or production.

### CRT-12 — Deadline engine

- **Scope:** Rules for dated disclosures, updates, expiry, escalation and record-level clocks.
- **Dependencies:** Prior data model, APIs, state transitions or provider integrations on which the feature depends; verify concrete dependency against current source.
- **Acceptance:** Tests must cover normal authorized operation, invalid inputs, cross-role/tenant access denial, audit/provenance preservation, retries/duplicates where applicable, and at least one documented failure/recovery case. UI milestones require keyboard and screen reader checks. Never equate mocked fixture or document with real-world ingestion, compliance, or production.

### CRT-13 — Import and ingestion framework

- **Scope:** Versioned import profiles, validation, deduplication, provenance, failures and retry-safe ingestion runs.
- **Dependencies:** Prior data model, APIs, state transitions or provider integrations on which the feature depends; verify concrete dependency against current source.
- **Acceptance:** Tests must cover normal authorized operation, invalid inputs, cross-role/tenant access denial, audit/provenance preservation, retries/duplicates where applicable, and at least one documented failure/recovery case. UI milestones require keyboard and screen reader checks. Never equate mocked fixture or document with real-world ingestion, compliance, or production.

### CRT-14 — Public API and exports

- **Scope:** Versioned read API, pagination, OpenAPI, machine-safe exports, rate limiting and permission checks.
- **Dependencies:** Prior data model, APIs, state transitions or provider integrations on which the feature depends; verify concrete dependency against current source.
- **Acceptance:** Tests must cover normal authorized operation, invalid inputs, cross-role/tenant access denial, audit/provenance preservation, retries/duplicates where applicable, and at least one documented failure/recovery case. UI milestones require keyboard and screen reader checks. Never equate mocked fixture or document with real-world ingestion, compliance, or production.

### CRT-15 — Administrative console

- **Scope:** Queues, review, edits, source verification, publication authorization and source health.
- **Dependencies:** Prior data model, APIs, state transitions or provider integrations on which the feature depends; verify concrete dependency against current source.
- **Acceptance:** Tests must cover normal authorized operation, invalid inputs, cross-role/tenant access denial, audit/provenance preservation, retries/duplicates where applicable, and at least one documented failure/recovery case. UI milestones require keyboard and screen reader checks. Never equate mocked fixture or document with real-world ingestion, compliance, or production.

### CRT-16 — Analytics/transparency dashboards

- **Scope:** Counts, changes, publication/source freshness and public-safe aggregated charts.
- **Dependencies:** Prior data model, APIs, state transitions or provider integrations on which the feature depends; verify concrete dependency against current source.
- **Acceptance:** Tests must cover normal authorized operation, invalid inputs, cross-role/tenant access denial, audit/provenance preservation, retries/duplicates where applicable, and at least one documented failure/recovery case. UI milestones require keyboard and screen reader checks. Never equate mocked fixture or document with real-world ingestion, compliance, or production.

### CRT-17 — Notifications and subscriptions

- **Scope:** User-controlled record-following, changes, subscription rate controls and delivery state.
- **Dependencies:** Prior data model, APIs, state transitions or provider integrations on which the feature depends; verify concrete dependency against current source.
- **Acceptance:** Tests must cover normal authorized operation, invalid inputs, cross-role/tenant access denial, audit/provenance preservation, retries/duplicates where applicable, and at least one documented failure/recovery case. UI milestones require keyboard and screen reader checks. Never equate mocked fixture or document with real-world ingestion, compliance, or production.

### CRT-18 — Security and production hardening

- **Scope:** Tenant isolation, audit integrity, file controls, accessibility, privacy, logging, backup and release gates.
- **Dependencies:** Prior data model, APIs, state transitions or provider integrations on which the feature depends; verify concrete dependency against current source.
- **Acceptance:** Tests must cover normal authorized operation, invalid inputs, cross-role/tenant access denial, audit/provenance preservation, retries/duplicates where applicable, and at least one documented failure/recovery case. UI milestones require keyboard and screen reader checks. Never equate mocked fixture or document with real-world ingestion, compliance, or production.

### CRT-19 — Open Legal Interpretations reference application

- **Scope:** Originally scheduled thin downstream reference app; preserve as historical scope, not embedded core.
- **Dependencies:** Prior data model, APIs, state transitions or provider integrations on which the feature depends; verify concrete dependency against current source.
- **Acceptance:** Tests must cover normal authorized operation, invalid inputs, cross-role/tenant access denial, audit/provenance preservation, retries/duplicates where applicable, and at least one documented failure/recovery case. UI milestones require keyboard and screen reader checks. Never equate mocked fixture or document with real-world ingestion, compliance, or production.

### CRT-20 — Legal interpretation ingestion

- **Scope:** Originally downstream source intake/extraction; generic source adapters belong in core only when truly reusable.
- **Dependencies:** Prior data model, APIs, state transitions or provider integrations on which the feature depends; verify concrete dependency against current source.
- **Acceptance:** Tests must cover normal authorized operation, invalid inputs, cross-role/tenant access denial, audit/provenance preservation, retries/duplicates where applicable, and at least one documented failure/recovery case. UI milestones require keyboard and screen reader checks. Never equate mocked fixture or document with real-world ingestion, compliance, or production.

### CRT-21 — Sam Ervin reference application

- **Scope:** Originally second thin application to test configurable abstractions; not a core library concept.
- **Dependencies:** Prior data model, APIs, state transitions or provider integrations on which the feature depends; verify concrete dependency against current source.
- **Acceptance:** Tests must cover normal authorized operation, invalid inputs, cross-role/tenant access denial, audit/provenance preservation, retries/duplicates where applicable, and at least one documented failure/recovery case. UI milestones require keyboard and screen reader checks. Never equate mocked fixture or document with real-world ingestion, compliance, or production.

### CRT-22 — Smart Cities Surveillance Registry reference

- **Scope:** Originally reference thin app; subsequently explicitly separated into standalone neophilism/Smart-Cities-Surveillance-Registry.
- **Dependencies:** Prior data model, APIs, state transitions or provider integrations on which the feature depends; verify concrete dependency against current source.
- **Acceptance:** Tests must cover normal authorized operation, invalid inputs, cross-role/tenant access denial, audit/provenance preservation, retries/duplicates where applicable, and at least one documented failure/recovery case. UI milestones require keyboard and screen reader checks. Never equate mocked fixture or document with real-world ingestion, compliance, or production.

## Approved changes and scope cautions

**Important approved change, October 7:** Core cleanup PR #25 removed product-specific Smart Cities/Open Legal features. Keep the generic source adapters, history, redaction, importer, SDK and publication infrastructure upstream, with each named registry in its own repository. Additional PRs beyond the original 22 implemented official source adapters, refresh, PDF ingestion, structured authority matching and operational controls. Do not revert the separation merely to satisfy this historical baseline.

## Authoritative implementation references

Read these current repository documents before coding; they may describe later improvements that are not reflected in the original 2026 roadmap:

- [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)
- [docs/DOMAIN_MODEL.md](../docs/DOMAIN_MODEL.md)
- [docs/PERSISTENCE.md](../docs/PERSISTENCE.md)
- [docs/INGESTION.md](../docs/INGESTION.md)
- [docs/RELATIONSHIPS.md](../docs/RELATIONSHIPS.md)
- [docs/PUBLICATION-LIFECYCLE.md](../docs/PUBLICATION-LIFECYCLE.md)
- [docs/DISCLOSURE-REDACTION.md](../docs/DISCLOSURE-REDACTION.md)
- [docs/AUDIT-INTEGRITY.md](../docs/AUDIT-INTEGRITY.md)
- [docs/SOURCE-REFRESH.md](../docs/SOURCE-REFRESH.md)

## Cross-account execution handoff

1. Read this file and the linked architecture/API/source documents; inspect latest `main` and the actual GitHub PR list, CI workflow results, branch protection, release tags, migration heads, and deployment environment.
2. Associate the stable CRT-01..CRT-22 **roadmap IDs**, not GitHub PR numbers, with actual merged code commits. Record source-of-truth mapping and add new approved roadmap versions for requirements added after this original plan.
3. Work from the first demonstrably incomplete milestone and dependencies. Preserve current downstream/core separation. Implement in reviewable PRs with regression tests, docs and deployment checks; chain healthy PRs when permitted.
4. Keep Engine Room milestone progress evidence separate from deployed/production state. Real source data needs source URL/date/validation; synthetic fixtures stay unmistakably labeled.
5. Only raise the user's attention for a material product/rights decision, missing deployment credentials/privileges, or blockers tests reveal—not routine implementation questions.

## Recovery confidence

**Full original numbered milestone sequence recovered**, with technical scope and acceptance expanded from available evidence. Precise verbatim wording and the present code→plan mapping still require a separate live reconciliation pass.
