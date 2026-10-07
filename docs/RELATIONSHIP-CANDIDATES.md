# Structured relationship candidates and legal-authority extraction

PR 23 adds a generic reviewable relationship-candidate workflow and uses it to propose legal-authority relationships from trusted PDF text in Open Legal Interpretations.

The key rule is:

> Extraction may propose. Only explicit review may materialize a canonical relationship.

## Generic relationship-candidate model

Migration `0013_relationship_candidates.sql` adds:

`civic_registry_relationship_candidates`

Each candidate stores:

- registry id;
- candidate id;
- relationship type;
- source record id;
- target record id;
- status: pending / approved / rejected;
- extractor id and version;
- confidence;
- structured evidence;
- evidence SHA-256;
- metadata;
- proposal timestamp / actor;
- review timestamp / actor / note; and
- materialized relationship id when approved.

The candidate model is provider/domain neutral. It can support future machine-proposed relationships outside legal interpretation applications.

## Proposal evidence is immutable

Once a candidate is inserted, its proposal fields cannot be changed through ordinary SQL:

- endpoints;
- relationship type;
- extractor/version;
- confidence;
- evidence;
- evidence hash;
- proposal metadata; and
- proposal identity/timestamp.

Direct candidate deletion is also blocked except during registry cascade deletion.

Review fields may only change when the generic review service enables a transaction-local review guard.

## Audit anchoring

Candidate proposal and review decisions write private audit events:

- `relationship_candidate.proposed`
- `relationship_candidate.approved`
- `relationship_candidate.rejected`

The proposal audit event commits the candidate's evidence SHA-256.

Because audit events are already part of PR 18's integrity chain, candidate proposal/review history is cryptographically anchored through the same existing mechanism.

Before approval/rejection, the review service:

1. recomputes the current candidate evidence SHA-256;
2. compares it with the immutable candidate hash; and
3. compares it with the original proposal audit-event hash.

If those values do not agree, review is refused.

## Approval behavior

Approval occurs in one database transaction.

The service:

1. locks the pending candidate;
2. revalidates the current registry relationship configuration and endpoint record types;
3. verifies candidate evidence integrity;
4. takes a relationship-specific transaction advisory lock;
5. checks for an already-existing equivalent relationship;
6. inserts the ordinary relationship if needed;
7. records reviewer/time/note on the candidate; and
8. emits the candidate approval audit event.

The ordinary relationship trigger separately emits `relationship.added` audit events with the reviewer's actor/reason context.

Concurrent reviewers approving equivalent candidates therefore cannot create duplicate relationships through the review service.

## Rejection behavior

Rejection records the reviewer/time/note and emits a private rejection audit event.

It does not create a relationship.

Reviewed candidates remain in history and cannot be reviewed again.

## Administrator review queue

Restricted route:

`/admin/registries/:registryId/relationship-candidates`

The queue shows:

- source and target record labels;
- relationship type;
- extractor/version;
- confidence;
- evidence SHA-256;
- matched citation;
- PDF document id;
- page number;
- exact matched text;
- surrounding excerpt; and
- recent review decisions.

Operators may approve or reject with an optional review note.

The main registry administrator dashboard also shows the number of pending relationship reviews.

## Open Legal Interpretations extractor

Extractor id:

`known-legal-authority-citation`

Version:

`1.0.0`

The extractor runs after PR 22 attachment/PDF processing in the PR 21 scheduled refresh worker.

It reads page-level persisted PDF extractions associated with the interpretation record.

It then compares explicit citations against known `legal_authority` records.

### Exact-only matching

PR 23 deliberately does not infer that every section numerically inside a configured statutory range belongs to that authority.

For example:

- FOIA is configured as `5 U.S.C. § 552`;
- the APA record is configured as `5 U.S.C. §§ 551–559`.

A naive range-membership matcher would incorrectly classify §552 as APA.

PR 23 therefore matches only:

1. the authority's canonical citation; or
2. an explicitly configured citation alias.

## Citation aliases

Open Legal Interpretations adds an optional `citation_aliases` JSON field on legal-authority records.

Aliases must be explicitly curated.

The demonstration APA authority includes aliases for:

- §551
- §553
- §554
- §555
- §556
- §557
- §558
- §559

It deliberately does **not** include §552.

This allows individual APA section citations to match without turning statutory numeric ranges into implicit semantic claims.

## Supported citation recognition

The extractor has structured recognition for explicit:

- U.S.C. citations; and
- C.F.R. citations.

It also performs flexible exact matching against configured citation/alias strings, which supports known case/report citations or other authority formats when their exact citation is configured.

Structured citation-shaped text that matches no known canonical citation/alias is counted as unresolved. It is not linked automatically and does not become a candidate.

## Candidate provenance

Multiple occurrences of the same known authority are aggregated into one candidate per evidence set.

Evidence contains up to 50 sorted mentions, each with:

- document id;
- citation id;
- page number;
- matched source text;
- matched configured authority citation/alias;
- match kind;
- surrounding excerpt; and
- per-mention confidence.

Candidate confidence is the strongest explicit match in the evidence set.

## Existing relationships

If the interpretation already has the canonical relationship to the authority, the extractor does not create another candidate.

The generic proposal service also checks for an existing equivalent relationship, protecting against races between extraction and review/manual relationship creation.

## Refresh metrics

The scheduled source-refresh run now records:

- authority mentions found;
- candidates created;
- existing candidates encountered;
- already-materialized authority relationships; and
- unresolved structured citation mentions.

Unresolved mentions are operational metadata, not automatic warnings, because the authority catalog may intentionally be incomplete.

## Tests

### Matching tests

PR 23 explicitly verifies:

- `5 U.S.C. § 552` matches FOIA;
- §552 does **not** match APA merely because it falls numerically inside `§§ 551–559`;
- explicitly configured `5 U.S.C. § 553` matches APA;
- unknown `5 U.S.C. § 999` remains unresolved; and
- already-materialized relationships are not proposed again.

### PostgreSQL review tests

The database test verifies:

- proposal/audit creation;
- evidence SHA-256 anchoring;
- direct SQL decision changes are blocked;
- proposal evidence mutation is blocked;
- approval creates the ordinary relationship;
- reviewer actor attribution appears in candidate and relationship audit events;
- an approved/rejected candidate cannot be reviewed twice;
- rejection creates no relationship;
- reviewed candidates cannot be directly deleted;
- deliberately bypassed evidence mutation is detected at review time; and
- the registry integrity chain remains valid.

## Trust boundary

PR 23 does not claim extracted text is legally authoritative interpretation by the software.

The software identifies explicit configured citation strings in primary-source text and proposes a relationship for human review.

The human review decision is the point at which a candidate becomes canonical registry data.

## Next milestone

A later milestone can expand the authority catalog/import process, add richer case-citation normalization, and provide unresolved-citation triage without weakening the explicit-review boundary.
