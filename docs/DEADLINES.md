# Configurable deadline engine

PR 12 adds a domain-neutral deadline engine for statutory, regulatory,
administrative, and operational timelines.

The governing abstraction is:

> anchor → offset/calendar → due date → warning window → pause/tolling →
> completion/cancellation → audit history

The engine does not hard-code any bill-specific deadline concept. Downstream
applications define deadline rules in registry configuration.

## Configuration

A registry may define reusable calendars and deadline definitions.

Example:

```yaml
deadlines:
  calendars:
    - id: federal_business_days
      weekendDays: [0, 6]
      excludedDates:
        - 2026-01-01

  definitions:
    - id: review_due
      label: Review due
      recordTypeIds:
        - document
      anchor:
        kind: field
        fieldId: published_on
      offset:
        value: 20
        unit: businessDays
      warningOffset:
        value: 5
        unit: businessDays
      calendarId: federal_business_days
      dateOnlyAnchorTime: end
      pauseWhileStatuses:
        - withdrawn
      completeWhenStatuses:
        - archived
      publiclyVisible: true
```

## Supported offsets

Deadline offsets may use:

- `hours`
- `calendarDays`
- `businessDays`
- `weeks`

Business-day arithmetic respects the selected deadline calendar.

## Calendars

A deadline calendar may configure:

- weekend weekdays using JavaScript/UTC weekday numbers;
- excluded calendar dates.

A calendar cannot exclude every weekday from business-day calculation.

Calendar configuration is explicit rather than relying on ambient operating
system locale or timezone behavior.

## Anchors

A deadline may be anchored to:

- record creation time;
- record publication time;
- a configured record field;
- the most recent entry into a configured lifecycle status;
- a manual event.

Field anchors require explicit record-type scope so field validity can be
checked at configuration time.

Date-only field/manual anchors are normalized to a configured start or end of
UTC day.

## Automatic materialization

When a record is created or reconciled, the database deadline service inspects
all configured deadline definitions that apply to the record.

For automatic definitions, it resolves the anchor and creates or updates the
corresponding deadline instance.

Definitions whose anchor cannot yet be resolved do not create a deadline until
the required event/value exists.

## Manual deadlines

Definitions with:

```yaml
anchor:
  kind: manual
```

may create keyed deadline instances programmatically.

A manual instance supplies:

- registry id;
- record id;
- deadline type id;
- optional instance key;
- explicit anchor time;
- optional actor/reason context;
- optional metadata.

Instance keys permit multiple independent deadlines of the same configured
type on one record.

## Deadline states

Persistent deadline state is one of:

- `open`
- `paused`
- `completed`
- `cancelled`

Public presentation additionally derives urgency:

- `open`
- `due_soon`
- `overdue`
- `paused`
- `completed`
- `cancelled`

Urgency is calculated from the current time, due date, and configured warning
offset. It is not stored as authoritative state.

## Warning windows

A definition may set `warningOffset`.

The warning time is calculated backward from the due date using the same
calendar semantics as the configured offset.

A live open deadline becomes `due_soon` at or after this time and becomes
`overdue` after the due date.

## Lifecycle integration

Deadline definitions may react to record lifecycle statuses.

A definition may configure:

- `pauseWhileStatuses`
- `completeWhenStatuses`
- `cancelWhenStatuses`

The same status cannot appear in conflicting directives for one definition.

Lifecycle transitions trigger deadline reconciliation automatically.

## Pause and tolling

When an open deadline enters a configured pause status:

- state becomes `paused`;
- `pausedAt` is recorded.

When it leaves all pause statuses:

- elapsed paused time is accumulated;
- state returns to `open`;
- due date is shifted forward by the paused duration.

This is elapsed-time tolling. The paused interval is added directly to the
existing due timestamp rather than recomputing the original business-day
offset.

Explicit manual pause/resume operations use the same tolling behavior.

## Status-entry anchors

A `statusEntered` anchor resolves from immutable record audit history.

The engine recognizes lifecycle transition execution and compatible record
status-change audit events.

This lets a downstream app express rules such as “24 hours after entering
review” without hard-coding review semantics into the engine.

## Completion and cancellation

A deadline can be completed or cancelled either:

- automatically from lifecycle status directives; or
- explicitly through the deadline service.

Completion/cancellation timestamps are stored with the instance.

Terminal deadline state is preserved by reconciliation.

## Persistence

Migration `0007_deadline_engine.sql` adds
`civic_registry_deadlines`.

Each instance stores:

- id;
- registry id;
- record id;
- deadline type id;
- instance key;
- anchor time;
- due time;
- state;
- pause state/tolling accumulation;
- completion/cancellation timestamps;
- created/updated times;
- generic metadata.

A uniqueness constraint prevents duplicate instances with the same configured
type and instance key for one record.

## Audit history

Database triggers emit immutable audit events for deadline changes.

Events include:

- `deadline.created`
- `deadline.updated`
- `deadline.paused`
- `deadline.resumed`
- `deadline.completed`
- `deadline.cancelled`
- `deadline.removed`

Deadline audit events use the existing record audit stream so public/private
history filtering remains consistent with the rest of the engine.

## Repository/service layer

`PostgresDeadlineService` provides:

- record reconciliation;
- registry-wide reconciliation;
- listing/filtering;
- manual instance creation;
- pause/resume;
- complete/cancel.

Record persistence and lifecycle transitions invoke the reconciler so ordinary
application writes do not need to remember to recalculate deadlines manually.

## Registry-wide reconciliation

The CLI supports deadline reconciliation across a registry.

This is useful after:

- adding/changing deadline configuration;
- importing records;
- correcting source data;
- deploying calendar changes.

The reconciliation command processes the complete registry rather than only
the first page of records.

## Public presentation

A deadline definition is public only when it explicitly sets:

```yaml
publiclyVisible: true
```

Public record pages and the public deadline API expose only public definitions
for records that are themselves publicly available.

The public view shows safe deadline metadata such as:

- label/description;
- due time;
- current state;
- urgency;
- pause/completion/cancellation time.

Private definitions remain available internally through the database/service
layer.

## Deliberately deferred

PR 12 does not add:

- email/SMS/push notification delivery;
- organization-specific holiday feeds;
- natural-language statutory rule parsing;
- timezone-per-record calculations;
- role-based deadline editing UI;
- escalation workflows;
- recurring cron-style deadlines.

Those belong in later notification/admin/integration work or downstream
policy-specific applications.
