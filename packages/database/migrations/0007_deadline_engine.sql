CREATE TABLE IF NOT EXISTS civic_registry_deadlines (
  registry_id TEXT NOT NULL,
  id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  deadline_type_id TEXT NOT NULL,
  instance_key TEXT NOT NULL DEFAULT 'automatic',
  anchor_at TIMESTAMPTZ NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  state TEXT NOT NULL CHECK (
    state IN ('open', 'paused', 'completed', 'cancelled')
  ),
  paused_at TIMESTAMPTZ,
  total_paused_seconds BIGINT NOT NULL DEFAULT 0 CHECK (
    total_paused_seconds >= 0
  ),
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (registry_id, id),
  CONSTRAINT civic_registry_deadlines_record_fk
    FOREIGN KEY (registry_id, record_id)
    REFERENCES civic_registry_records(registry_id, id)
    ON DELETE CASCADE,
  CONSTRAINT civic_registry_deadlines_unique_instance
    UNIQUE (
      registry_id,
      record_id,
      deadline_type_id,
      instance_key
    ),
  CONSTRAINT civic_registry_deadlines_pause_state_check
    CHECK (
      (state = 'paused' AND paused_at IS NOT NULL)
      OR (state <> 'paused' AND paused_at IS NULL)
    ),
  CONSTRAINT civic_registry_deadlines_completion_check
    CHECK (
      (state = 'completed' AND completed_at IS NOT NULL)
      OR (state <> 'completed' AND completed_at IS NULL)
    ),
  CONSTRAINT civic_registry_deadlines_cancellation_check
    CHECK (
      (state = 'cancelled' AND cancelled_at IS NOT NULL)
      OR (state <> 'cancelled' AND cancelled_at IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS civic_registry_deadlines_record_idx
  ON civic_registry_deadlines (
    registry_id,
    record_id,
    due_at
  );

CREATE INDEX IF NOT EXISTS civic_registry_deadlines_due_idx
  ON civic_registry_deadlines (
    registry_id,
    state,
    due_at
  );

CREATE OR REPLACE FUNCTION civic_registry_deadline_is_public(
  registry_value TEXT,
  record_value TEXT,
  deadline_type_value TEXT
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  SELECT COALESCE(
    (
      SELECT
        record.visibility = 'public'
        AND COALESCE(
          (
            SELECT
              (definition ->> 'publiclyVisible')::boolean
            FROM jsonb_array_elements(
              COALESCE(
                config.config -> 'deadlines' -> 'definitions',
                '[]'::jsonb
              )
            ) AS definition
            WHERE definition ->> 'id' =
              deadline_type_value
            LIMIT 1
          ),
          false
        )
      FROM civic_registry_records AS record
      INNER JOIN civic_registry_configurations AS config
        ON config.registry_id = record.registry_id
      WHERE record.registry_id = registry_value
        AND record.id = record_value
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION civic_registry_capture_deadline_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  row_value civic_registry_deadlines;
  event_name TEXT;
  event_visibility TEXT;
  old_state TEXT;
BEGIN
  row_value := CASE
    WHEN TG_OP = 'DELETE' THEN OLD
    ELSE NEW
  END;

  event_visibility := CASE
    WHEN civic_registry_deadline_is_public(
      row_value.registry_id,
      row_value.record_id,
      row_value.deadline_type_id
    )
    THEN 'public'
    ELSE 'private'
  END;

  IF TG_OP = 'INSERT' THEN
    event_name := 'deadline.created';
  ELSIF TG_OP = 'DELETE' THEN
    event_name := 'deadline.deleted';
  ELSE
    old_state := OLD.state;

    IF OLD.state IS DISTINCT FROM NEW.state THEN
      event_name := CASE NEW.state
        WHEN 'paused' THEN 'deadline.paused'
        WHEN 'completed' THEN 'deadline.completed'
        WHEN 'cancelled' THEN 'deadline.cancelled'
        WHEN 'open' THEN
          CASE
            WHEN OLD.state = 'paused'
              THEN 'deadline.resumed'
            ELSE 'deadline.reopened'
          END
      END;
    ELSIF
      OLD.anchor_at IS DISTINCT FROM NEW.anchor_at
      OR OLD.due_at IS DISTINCT FROM NEW.due_at
    THEN
      event_name := 'deadline.recalculated';
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO civic_registry_audit_events (
    registry_id,
    subject_type,
    subject_id,
    event_type,
    occurred_at,
    visibility,
    actor_id,
    reason,
    metadata
  )
  VALUES (
    row_value.registry_id,
    'record',
    row_value.record_id,
    event_name,
    NOW(),
    event_visibility,
    civic_registry_history_setting(
      'civic_registry.actor_id'
    ),
    civic_registry_history_setting(
      'civic_registry.reason'
    ),
    jsonb_strip_nulls(
      jsonb_build_object(
        'deadlineId', row_value.id,
        'deadlineTypeId', row_value.deadline_type_id,
        'instanceKey', row_value.instance_key,
        'anchorAt', row_value.anchor_at,
        'dueAt', row_value.due_at,
        'state', row_value.state,
        'previousState', old_state,
        'pausedAt', row_value.paused_at,
        'completedAt', row_value.completed_at,
        'cancelledAt', row_value.cancelled_at
      )
    )
  );

  RETURN row_value;
END;
$$;

DROP TRIGGER IF EXISTS
  civic_registry_deadline_history_trigger
  ON civic_registry_deadlines;

CREATE TRIGGER civic_registry_deadline_history_trigger
AFTER INSERT OR UPDATE OR DELETE
ON civic_registry_deadlines
FOR EACH ROW
EXECUTE FUNCTION civic_registry_capture_deadline_history();
