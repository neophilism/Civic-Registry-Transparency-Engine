# Reviewable relationship candidates

The engine supports machine- or rule-proposed relationships without allowing an
extractor to silently create canonical public facts.

The key rule is:

> Extraction may propose. Only explicit review may materialize a canonical
> relationship.

## Generic candidate model

`civic_registry_relationship_candidates` stores:

- registry id and candidate id;
- relationship type;
- source and target record ids;
- pending / approved / rejected status;
- extractor id and version;
- confidence;
- structured evidence;
- evidence SHA-256;
- metadata;
- proposal actor/time;
- review actor/time/note; and
- the materialized relationship id when approved.

The schema contains no domain-specific relationship vocabulary.

## Immutable proposal evidence

After proposal, the candidate's endpoints, relationship type, extractor
identity, confidence, evidence, hash, metadata, and proposal identity are
immutable.

Proposal and review decisions create private audit events. Candidate evidence is
hash-anchored into the same immutable audit chain used by the rest of the
engine.

## Approval

Approval occurs in one transaction. The service:

1. locks the pending candidate;
2. revalidates current registry relationship configuration and endpoint types;
3. verifies evidence integrity;
4. takes a relationship-specific advisory lock;
5. checks for an equivalent existing relationship;
6. inserts the ordinary relationship if needed;
7. records reviewer/time/note; and
8. emits the approval audit event.

Equivalent concurrent approvals cannot create duplicate canonical
relationships through the service.

## Rejection

Rejection records the review decision and audit event without creating a
relationship. Reviewed candidates remain historical records and cannot be
reviewed again.

## Administrator queue

The restricted relationship-candidate view exposes proposal identity,
endpoints, confidence, evidence hash, structured evidence, and recent decisions.
Operators may approve or reject with an optional note.

## Downstream extractors

The engine intentionally does not ship a domain-specific extractor. Downstream
applications may build extractors for their own documents, identifiers, entity
models, or relationship types and submit candidates through the generic
service.

## Tests

The core regression suite verifies:

- deterministic evidence hashing;
- immutable proposal fields;
- review-only decisions;
- audited approval;
- canonical relationship materialization;
- prevention of second review; and
- cryptographic integrity.

Extractor semantics belong in downstream repositories.
