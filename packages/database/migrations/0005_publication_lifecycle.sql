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
