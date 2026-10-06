# Administrator console

PR 15 adds a restricted operator surface at `/admin`.

## Security boundary

The public site and `/api/v1` remain disclosure-filtered, read-only
surfaces. The administrator console is intentionally an internal view of
canonical records and operational state.

The console is disabled unless the server has:

```
CIVIC_REGISTRY_ADMIN_TOKEN=<a long random secret>
```

Operators sign in with that token plus an actor ID and the lifecycle roles
they intend to exercise. The token creates an HTTP-only, SameSite=Strict,
signed session that expires after eight hours. Roles supplied at sign-in do
not bypass registry policy: lifecycle requests and approval decisions still
pass through the existing publication lifecycle service and its configured
role checks.

Production deployments should additionally place `/admin` behind their
normal identity-aware proxy, SSO, VPN, or equivalent network/application
access control. The built-in token is a portable engine-level guard, not a
replacement for organization identity infrastructure.

## Capabilities

The console provides:

- cross-registry operational summaries;
- canonical record creation and schema-driven editing;
- lifecycle transition requests and approval decisions;
- open and overdue deadline views plus deadline state actions;
- deadline reconciliation;
- recent ingestion-run visibility and item-level ingestion failures;
- source listing and source creation;
- immutable record revision and audit-event inspection;
- installed registry configuration validation.

Record status is never edited directly for lifecycle-managed registries.
Status changes go through `PostgresPublicationLifecycleService`.

Record fields are generated from the compiled registry schema and record
writes continue through `PostgresRecordRepository`, which runs the normal
domain/config validation and deadline reconciliation.

## Auditing

The console supplies operator context to lifecycle and deadline services.\nRecord writes pass actor/reason context through the record repository on the\nsame PostgreSQL transaction that fires the immutable history trigger, so\nrecord revisions and audit events are attributed without relying on pooled\nconnection state.

## Deliberate exclusions

PR 15 does not add a browser-based arbitrary registry-configuration editor or
raw SQL/debug console. Registry configuration remains a deployable,
reviewable artifact. This avoids turning the administrator UI into a path for
unreviewed schema/workflow changes.

The console also does not expose or weaken the public API disclosure boundary.
