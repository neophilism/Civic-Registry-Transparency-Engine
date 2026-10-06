CREATE TABLE IF NOT EXISTS civic_registry_notification_subscriptions (
  registry_id TEXT NOT NULL,
  id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (
    scope IN ('public', 'internal')
  ),
  channel TEXT NOT NULL CHECK (
    channel IN ('email', 'webhook', 'internal')
  ),
  target JSONB NOT NULL,
  event_types TEXT[] NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  actor_id TEXT,
  PRIMARY KEY (registry_id, id),
  CONSTRAINT civic_registry_notification_subscriptions_registry_fk
    FOREIGN KEY (registry_id)
    REFERENCES civic_registry_configurations(registry_id)
    ON DELETE CASCADE,
  CONSTRAINT civic_registry_notification_subscriptions_events_check
    CHECK (cardinality(event_types) > 0)
);

CREATE INDEX IF NOT EXISTS
  civic_registry_notification_subscriptions_active_idx
  ON civic_registry_notification_subscriptions (
    registry_id,
    enabled,
    channel
  );

CREATE TABLE IF NOT EXISTS civic_registry_notification_events (
  registry_id TEXT NOT NULL,
  id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'record.published',
      'record.changed',
      'record.matching_created',
      'deadline.approaching',
      'deadline.missed',
      'document.added'
    )
  ),
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (
    visibility IN (
      'public',
      'restricted',
      'private',
      'embargoed'
    )
  ),
  occurred_at TIMESTAMPTZ NOT NULL,
  dedupe_key TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (registry_id, id),
  CONSTRAINT civic_registry_notification_events_registry_fk
    FOREIGN KEY (registry_id)
    REFERENCES civic_registry_configurations(registry_id)
    ON DELETE CASCADE,
  CONSTRAINT civic_registry_notification_events_dedupe
    UNIQUE (registry_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS
  civic_registry_notification_events_recent_idx
  ON civic_registry_notification_events (
    registry_id,
    occurred_at DESC,
    id DESC
  );

CREATE TABLE IF NOT EXISTS civic_registry_notification_deliveries (
  registry_id TEXT NOT NULL,
  id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (
    channel IN ('email', 'webhook', 'internal')
  ),
  target JSONB NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'processing', 'sent', 'failed')
  ),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (
    attempts >= 0
  ),
  next_attempt_at TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  PRIMARY KEY (registry_id, id),
  CONSTRAINT civic_registry_notification_deliveries_event_fk
    FOREIGN KEY (registry_id, event_id)
    REFERENCES civic_registry_notification_events(registry_id, id)
    ON DELETE CASCADE,
  CONSTRAINT civic_registry_notification_deliveries_subscription_fk
    FOREIGN KEY (registry_id, subscription_id)
    REFERENCES civic_registry_notification_subscriptions(registry_id, id)
    ON DELETE CASCADE,
  CONSTRAINT civic_registry_notification_delivery_unique
    UNIQUE (
      registry_id,
      event_id,
      subscription_id
    )
);

CREATE INDEX IF NOT EXISTS
  civic_registry_notification_deliveries_dispatch_idx
  ON civic_registry_notification_deliveries (
    registry_id,
    status,
    next_attempt_at,
    created_at
  );

CREATE TABLE IF NOT EXISTS civic_registry_internal_notifications (
  registry_id TEXT NOT NULL,
  id TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  read_at TIMESTAMPTZ,
  PRIMARY KEY (registry_id, id),
  CONSTRAINT civic_registry_internal_notifications_delivery_fk
    FOREIGN KEY (registry_id, delivery_id)
    REFERENCES civic_registry_notification_deliveries(registry_id, id)
    ON DELETE CASCADE,
  CONSTRAINT civic_registry_internal_notifications_event_fk
    FOREIGN KEY (registry_id, event_id)
    REFERENCES civic_registry_notification_events(registry_id, id)
    ON DELETE CASCADE,
  CONSTRAINT civic_registry_internal_notification_unique
    UNIQUE (registry_id, delivery_id)
);

CREATE INDEX IF NOT EXISTS
  civic_registry_internal_notifications_inbox_idx
  ON civic_registry_internal_notifications (
    registry_id,
    recipient_id,
    read_at,
    created_at DESC
  );
