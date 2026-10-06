# Immutable record revision history

PR 9 adds database-enforced revision history and public change tracking.

## Core guarantee

Meaningful changes to `civic_registry_records` are captured by a PostgreSQL
trigger.

The trigger records an immutable snapshot **after the same database statement
that changes the record**. If history capture fails, the record mutation fails
with the transaction.

This means application code cannot silently rewrite a record merely by bypassing
the TypeScript repository and issuing a normal SQL `UPDATE`.

## What counts as a revision

A new record revision is captured when any public-domain record property changes:

- record type;
- configured fields;
- status;
- visibility;
- external identifiers;
- tags;
- original creation timestamp;
- publication timestamp.

Internal-only updates do not create revisions. In particular, rebuilding
`search_text` during a search reindex does not manufacture fake public
history.

## Existing records at upgrade time

Migration `0004_immutable_revision_history.sql` snapshots every record that
already exists.

Those snapshots use:

```text
operation = baseline
event = record.history_initialized
```

The UI explicitly says that history tracking began with that snapshot and that
earlier revisions are **not reconstructed**.

The migration does not pretend to know changes that occurred before the history
system existed.

## Immutable storage

PR 9 adds:

- `civic_registry_record_versions`;
- `civic_registry_audit_events`.

Normal `UPDATE` and `DELETE` operations against either history table are
blocked by database triggers.

Deleting an entire registry remains an explicit lifecycle operation and may
cascade its registry-scoped data; individual history rows cannot be edited or
selectively deleted while the registry exists.

## Record versions

Each revision stores:

- registry ID;
- record ID;
- monotonically increasing version number;
- operation: baseline / created / updated / deleted;
- visibility;
- complete record snapshot;
- capture time;
- optional actor ID;
- optional reason.

History does not depend on the current record row, so a record's snapshots
survive ordinary record deletion.

## Generic audit-event convention

PR 9 introduces a generic core `AuditEvent` shape:

```text
id
registryId
subjectType
subjectId
eventType
occurredAt
visibility
actorId?
reason?
metadata?
```

This is intentionally generic rather than bill-specific and is suitable as the
shared audit-event convention for sibling engines.

The Registry Engine currently emits events with:

```text
subjectType = record
```

## Record events

Database triggers emit human-readable event primitives including:

- `record.created`;
- `record.fields_changed`;
- `record.published`;
- `record.withdrawn`;
- `record.status_changed`;
- `record.visibility_changed`;
- `record.metadata_changed`;
- `record.deleted`;
- `record.history_initialized`.

Field-change metadata records field IDs, not duplicated field values. The
presentation layer resolves those IDs through the registry configuration.

## Relationship events

Relationship mutations emit events for both endpoints:

- `relationship.added`;
- `relationship.removed`;
- `relationship.history_initialized`.

Event metadata records:

- relationship ID;
- relationship type;
- inbound/outbound storage direction;
- related record ID.

The presentation layer applies configured relationship and inverse labels.

## Evidence events

Citation mutations emit:

- `evidence.citation_added`;
- `evidence.citation_updated`;
- `evidence.citation_removed`;
- `evidence.citation_history_initialized`.

No-op citation updates are ignored.

Existing citations at upgrade time receive baseline events rather than false
"added" events.

## Visibility safety

Each version and event has generic visibility.

The public history interface queries only:

```text
visibility = public
```

A transition involving a non-public record is not exposed as a public audit
event. Public revision snapshots only contain versions whose stored record
visibility is public.

If a record moves through a non-public state and later becomes public again,
the public timeline may contain a deliberate gap rather than revealing the
hidden state.

## Optional actor and reason context

The database trigger reads transaction-local PostgreSQL settings:

```text
civic_registry.actor_id
civic_registry.reason
```

Administrative workflows can set these values before a mutation so the
resulting immutable version and event carry attribution/reason context.

They are optional because the current public reference application does not yet
have the PR 15 administration/authentication workflow.

## Public interface

Record pages show a compact History section.

The complete view is:

```text
/registries/:registryId/records/:recordId/history
```

It contains:

- public audit timeline;
- public immutable revisions;
- before/after differences between visible revisions;
- complete public snapshot fields for each revision;
- explicit baseline notices for pre-history records.

## Public API

```text
GET /api/registries/:registryId/records/:recordId/history
```

The API returns public-safe presentation objects rather than internal table
rows.

## Deliberate limits

PR 9 provides database immutability against ordinary row mutation, not
cryptographic append-only storage.

Hash chaining, external notarization, tamper-evident backups, and hardened audit
log integrity testing remain appropriate PR 18 hardening work.
