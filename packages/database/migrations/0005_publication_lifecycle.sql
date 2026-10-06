CREATE TABLE IF NOT EXISTS civic_registry_transition_requests (
  registry_id TEXT NOT NULL,
  id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  from_status_id TEXT NOT NULL,
  to_status_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'executed', 'rejected', 'cancelled')
  ),
  requested_by TEXT,
  requested_roles TEXT[] NOT NULL DEFAULT '{}'::text[],
  requested_at TIMESTAMPTZ NOT NULL,
  reason TEXT,
  required_approvals INTEGER NOT NULL DEFAULT 1 CHECK (
    required_approvals > 0
  ),
  requester_cannot_approve BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (registry_id, id),
  CONSTRAINT civic_registry_transition_requests_registry_fk
    FOREIGN KEY (registry_id)
    REFERENCES civic_registry_configurations(registry_id)
    ON DELETE CASCADE,
  CONSTRAINT civic_registry_transition_requests_record_fk
    FOREIGN KEY (registry_id, record_id)
    REFERENCES civic_registry_records(registry_id, id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS
  civic_registry_transition_requests_pending_unique
  ON civic_registry_transition_requests (
    registry_id,
    record_id,
    to_status_id
  )
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS
  civic_registry_transition_requests_record_idx
  ON civic_registry_transition_requests (
    registry_id,
    record_id,
    requested_at DESC
  );

CREATE INDEX IF NOT EXISTS
  civic_registry_transition_requests_status_idx
  ON civic_registry_transition_requests (
    registry_id,
    status,
    requested_at
  );

CREATE TABLE IF NOT EXISTS civic_registry_transition_decisions (
  registry_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (
    decision IN ('approved', 'rejected')
  ),
  actor_roles TEXT[] NOT NULL DEFAULT '{}'::text[],
  decided_at TIMESTAMPTZ NOT NULL,
  note TEXT,
  PRIMARY KEY (registry_id, request_id, actor_id),
  CONSTRAINT civic_registry_transition_decisions_request_fk
    FOREIGN KEY (registry_id, request_id)
    REFERENCES civic_registry_transition_requests(registry_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS
  civic_registry_transition_decisions_request_idx
  ON civic_registry_transition_decisions (
    registry_id,
    request_id,
    decided_at
  );

CREATE TABLE IF NOT EXISTS civic_registry_publication_schedules (
  registry_id TEXT NOT NULL,
  id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  from_status_id TEXT NOT NULL,
  target_status_id TEXT NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'executed', 'cancelled', 'failed')
  ),
  requested_by TEXT,
  requested_roles TEXT[] NOT NULL DEFAULT '{}'::text[],
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  failure_reason TEXT,
  PRIMARY KEY (registry_id, id),
  CONSTRAINT civic_registry_publication_schedules_registry_fk
    FOREIGN KEY (registry_id)
    REFERENCES civic_registry_configurations(registry_id)
    ON DELETE CASCADE,
  CONSTRAINT civic_registry_publication_schedules_record_fk
    FOREIGN KEY (registry_id, record_id)
    REFERENCES civic_registry_records(registry_id, id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS
  civic_registry_publication_schedules_pending_unique
  ON civic_registry_publication_schedules (
    registry_id,
    record_id
  )
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS
  civic_registry_publication_schedules_due_idx
  ON civic_registry_publication_schedules (
    status,
    scheduled_for,
    registry_id
  )
  WHERE status = 'pending';


CREATE OR REPLACE FUNCTION civic_registry_enforce_lifecycle_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  lifecycle JSONB;
  initial_status TEXT;
  status_exists BOOLEAN;
  transition_exists BOOLEAN;
  bootstrap_allowed BOOLEAN;
  transition_allowed BOOLEAN;
BEGIN
  SELECT config -> 'publicationLifecycle'
  INTO lifecycle
  FROM civic_registry_configurations
  WHERE registry_id = NEW.registry_id;

  IF lifecycle IS NULL
    OR lifecycle = 'null'::jsonb
  THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      COALESCE(
        lifecycle -> 'statuses',
        '[]'::jsonb
      )
    ) AS status
    WHERE status ->> 'id' = NEW.status
  )
  INTO status_exists;

  IF NOT status_exists THEN
    RAISE EXCEPTION
      'Status % is not configured in the publication lifecycle for registry %.',
      NEW.status,
      NEW.registry_id
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    initial_status :=
      lifecycle ->> 'initialStatusId';
    bootstrap_allowed :=
      COALESCE(
        current_setting(
          'civic_registry.lifecycle_bootstrap',
          true
        ),
        ''
      ) = 'allowed';

    IF
      NEW.status IS DISTINCT FROM initial_status
      AND NOT bootstrap_allowed
    THEN
      RAISE EXCEPTION
        'New records in registry % must begin in lifecycle status %.',
        NEW.registry_id,
        initial_status
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      COALESCE(
        lifecycle -> 'transitions',
        '[]'::jsonb
      )
    ) AS transition
    WHERE transition ->> 'fromStatusId' = OLD.status
      AND transition ->> 'toStatusId' = NEW.status
  )
  INTO transition_exists;

  IF NOT transition_exists THEN
    RAISE EXCEPTION
      'Lifecycle transition % -> % is not configured for registry %.',
      OLD.status,
      NEW.status,
      NEW.registry_id
      USING ERRCODE = '23514';
  END IF;

  transition_allowed :=
    COALESCE(
      current_setting(
        'civic_registry.lifecycle_transition',
        true
      ),
      ''
    ) = 'allowed';

  IF NOT transition_allowed THEN
    RAISE EXCEPTION
      'Lifecycle status changes must use the publication lifecycle service.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS
  civic_registry_lifecycle_status_guard
  ON civic_registry_records;

CREATE TRIGGER civic_registry_lifecycle_status_guard
BEFORE INSERT OR UPDATE OF status
ON civic_registry_records
FOR EACH ROW
EXECUTE FUNCTION civic_registry_enforce_lifecycle_status();
