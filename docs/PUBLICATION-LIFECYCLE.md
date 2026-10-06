# Configurable publication lifecycle

PR 10 adds a generic publication workflow to the Civic Registry &
Transparency Engine.

The engine does not hard-code terms such as "legal interpretation",
"surveillance technology", or "federal program". A downstream registry
declares its own statuses, transitions, role names, approval rules, and
scheduled-publication behavior.

## Configuration model

A registry may define:

```yaml
publicationLifecycle:
  initialStatusId: draft

  statuses:
    - id: draft
      label: Draft

    - id: approved
      label: Approved

    - id: published
      label: Published
      publiclyVisible: true
      marksPublished: true

  transitions:
    - fromStatusId: draft
      toStatusId: approved
      allowedRoles: [editor]

    - fromStatusId: approved
      toStatusId: published
      allowedRoles: [publisher]

  scheduledPublication:
    enabled: true
    fromStatusIds: [approved]
    targetStatusId: published
    allowedRoles: [publisher]
```

## Status semantics

Each status may define:

- `publiclyVisible`: records in this state may appear on public surfaces;
- `marksPublished`: entering this state establishes the record's first
  `publishedAt` timestamp;
- `terminal`: the configuration cannot define outgoing transitions.

A status that sets `marksPublished: true` must also be publicly visible.

The first time a record enters a publication-marking state, `publishedAt` is
set. Later withdrawal and republication preserve that original publication
timestamp.

## Two independent public-safety conditions

Generic visibility and publication lifecycle state are deliberately separate.

A record is publicly retrievable only when:

1. `record.visibility === "public"`; and
2. its lifecycle status has `publiclyVisible: true`.

This rule applies to:

- record detail lookup;
- record lists;
- full-text search and facets;
- relationship traversal;
- public revision history.

A draft with generic `visibility: public` therefore does **not** leak onto
public surfaces.

Registries without a configured publication lifecycle retain the pre-PR-10
visibility behavior.

## Initial-state enforcement

Normal record creation must use `initialStatusId`.

The PostgreSQL lifecycle guard enforces the same rule, so direct SQL cannot
normally create a record already in an approved or published state.

Imports and seeds may explicitly opt into:

```ts
{ bootstrapLifecycle: true }
```

That path is for pre-existing data whose real-world state predates the engine.
It is intentionally separate from ordinary application creation.

## Transition enforcement

A status change is valid only when a configured transition exists.

The engine enforces this at two layers:

1. the lifecycle service validates roles and approvals;
2. a PostgreSQL trigger validates the configured state transition and rejects
   unauthorised direct SQL status changes.

The service authorizes its transaction with the local PostgreSQL setting:

```text
civic_registry.lifecycle_transition = allowed
```

This setting is an internal implementation boundary, not a public permission
mechanism.

## Roles

Role identifiers are generic strings supplied by the shared authentication and
authorization layer.

For example:

```yaml
allowedRoles:
  - reviewer
  - publisher
```

PR 10 does not create a competing user/account system. It consumes role strings
provided by the caller so the eventual shared auth foundation can be used by
all core engines.

## Approval-gated transitions

A transition may require approval:

```yaml
approval:
  approverRoles:
    - reviewer
    - publisher
  minApprovals: 2
  requesterCannotApprove: true
```

Approval requests are durable database records.

The engine supports:

- one decision per actor per request;
- approval thresholds;
- rejection;
- optional requester self-approval prohibition;
- immutable audit events for request, approval/rejection, and execution.

## Scheduled publication

Scheduled publication is configured separately from approval.

A schedulable source state must have a direct configured transition to the
target state, and that transition cannot itself require approval.

This intentionally models:

```text
review / approval
        ↓
   approved state
        ↓
 schedule publication
        ↓
 published state
```

rather than silently performing an approval at a future clock time.

Schedules are durable and can be:

- pending;
- executed;
- cancelled;
- failed.

The due processor re-validates the current registry configuration and current
record state before executing. A stale schedule fails safely instead of forcing
publication.

## Running due publications

PR 10 exposes:

```bash
pnpm db:publish-due
```

An optional positive integer argument limits the batch size.

This command is suitable for a scheduler/cron/job runner. PR 10 does not
introduce a second background-job framework.

## Persistence

Migration `0005_publication_lifecycle.sql` adds:

- `civic_registry_transition_requests`;
- `civic_registry_transition_decisions`;
- `civic_registry_publication_schedules`;
- database-level lifecycle state-machine guards.

## Audit history

Lifecycle actions emit generic private audit events such as:

- `lifecycle.transition_requested`;
- `lifecycle.transition_approved`;
- `lifecycle.transition_rejected`;
- `lifecycle.transition_executed`;
- `lifecycle.publication_scheduled`;
- `lifecycle.publication_schedule_cancelled`;
- `lifecycle.publication_schedule_failed`;
- `lifecycle.publication_schedule_executed`.

Actual record status mutations continue to produce the immutable PR 9 record
versions and status events in the same database transaction.

## Public history

A lifecycle-managed registry may intentionally have non-public draft/review
states even when the generic visibility column is public.

The public History interface therefore filters both:

- audit-event/revision generic visibility; and
- lifecycle-state public visibility.

A hidden workflow state may create a deliberate gap in the public timeline.
The engine does not expose internal review states merely to make the public
timeline continuous.

## Deliberately deferred

PR 10 does not add:

- user accounts;
- login/session handling;
- organization membership;
- role assignment;
- an administrative review inbox;
- browser forms for approving or scheduling publication.

Those belong to the shared auth foundation and PR 15 administration console.
PR 10 provides the reusable lifecycle engine those interfaces will call.
