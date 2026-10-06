# Notifications and subscriptions

PR 17 adds durable, configuration-driven notification subscriptions to the Civic Registry & Transparency Engine.

The notification pipeline is:

`registry/audit/deadline/document state -> notification event -> subscription match -> delivery outbox -> channel adapter -> retry/audit`

No bill-specific event, recipient, agency, or policy concept is hard-coded into the engine.

## Event types

Registries may enable any subset of these reusable events:

- `record.published`
- `record.changed`
- `record.matching_created`
- `deadline.approaching`
- `deadline.missed`
- `document.added`

Record events are derived from the immutable audit stream, so ordinary repository writes and database-enforced history feed the same notification system.

Deadline events are derived from open deadline instances. The approaching horizon is configured per registry.

Document events are derived from persisted evidence documents.

## Registry configuration

Example:

```yaml
notifications:
  enabled: true
  eventTypes:
    - record.published
    - record.changed
    - record.matching_created
    - deadline.approaching
    - deadline.missed
    - document.added
  allowedChannels:
    - email
    - webhook
    - internal
  deadlineApproachingDays: 7
  maxDeliveryAttempts: 5
  retryBaseSeconds: 60
```

If notifications are absent or `enabled: false`, the notification service refuses subscription creation and processing for that registry.

## Subscription scopes

Subscriptions have either `public` or `internal` scope.

A public-scope subscription can match only notification events whose event visibility is `public`.

Record notification events are public only when the current record is public and is not whole-record withheld.

Public deadline events require the existing public-deadline rule and are suppressed for whole-record withheld records.

Public document events require a public document whose disclosure state is fully disclosed.

The notification payload intentionally contains only generic metadata required for notification matching and presentation. It does not copy canonical record fields into the outbox.

## Generic filters

Subscriptions can filter on:

- record type ids;
- record ids;
- lifecycle status ids; and
- tags.

This allows `record.matching_created` to act as a generic new-matching-record subscription without embedding application-specific matching code.

Filters are applied to the event payload and are independent of the delivery channel.

## Channels

### Internal notifications

Internal delivery writes a durable inbox item for a `recipientId`.

The administrator notification console shows the signed-in administrator's inbox and supports marking items read.

### Webhooks

Webhook targets must:

- use HTTPS;
- include a signing secret of at least 16 characters;
- not contain URL credentials;
- not target localhost or private/reserved IP literals; and
- resolve only to non-private addresses at delivery time.

Redirects are not followed.

Each webhook request contains:

- `X-Civic-Registry-Delivery`
- `X-Civic-Registry-Event`
- `X-Civic-Registry-Signature: sha256=<HMAC>`

The HMAC is SHA-256 over the exact JSON request body using the subscription secret.

### Email

Email uses a provider-neutral HTTP relay contract rather than hard-coding a mail vendor.

Configure:

```text
CIVIC_REGISTRY_EMAIL_RELAY_URL=
CIVIC_REGISTRY_EMAIL_RELAY_TOKEN=
CIVIC_REGISTRY_EMAIL_FROM=
```

The engine sends an authenticated JSON POST containing:

```json
{
  "to": "recipient@example.org",
  "from": "registry@example.org",
  "subject": "[Registry name] Record published",
  "text": "…",
  "metadata": {
    "registryId": "…",
    "eventId": "…",
    "eventType": "record.published",
    "deliveryId": "…"
  }
}
```

The relay is responsible for translating this neutral contract to the chosen mail provider.

Production relay URLs must use HTTPS.

## Durable outbox and retries

Notification events have registry-scoped deduplication keys.

A delivery is unique for one event/subscription pair, preventing repeated collector runs from generating duplicate deliveries.

Dispatch claims pending work with PostgreSQL `FOR UPDATE SKIP LOCKED`.

Delivery attempts use exponential backoff based on `retryBaseSeconds`, capped at 24 hours. After `maxDeliveryAttempts`, the delivery becomes terminally failed.

A stale `processing` delivery can be reclaimed after 15 minutes, allowing recovery after process interruption.

## Operations

Run one registry:

```bash
pnpm db:notifications-run public-document-catalog
```

Run every installed registry with notifications enabled:

```bash
pnpm db:notifications-run
```

Production deployments should execute the runner on a recurring scheduler.

The administrator console also provides a manual **Run now** action using the same collector/materializer/dispatcher pipeline.

## Administrator console

The registry notification console is available at:

`/admin/registries/:registryId/notifications`

It supports:

- subscription creation;
- public/internal scope selection;
- email/webhook/internal targets;
- generic event and record filters;
- enable/disable;
- deletion;
- manual processing;
- delivery status and retry inspection; and
- the signed-in administrator's internal inbox.

Webhook signing secrets are accepted on creation but are not rendered back in the console.

## Audit history

Subscription creation, enable/disable, and deletion create private immutable audit events with generic `notification.subscription_*` event names.

## Deliberate boundary

PR 17 does not provide unauthenticated public email signup.

A public self-service subscription feature would require explicit ownership verification, confirmation, unsubscribe, abuse controls, and rate limiting. The core delivered here supports public-scope subscriptions while keeping subscription administration restricted.
