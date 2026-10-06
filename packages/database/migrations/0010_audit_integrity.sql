CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS civic_registry_integrity_heads (
  registry_id TEXT PRIMARY KEY,
  sequence BIGINT NOT NULL DEFAULT 0 CHECK (
    sequence >= 0
  ),
  head_hash TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT civic_registry_integrity_heads_registry_fk
    FOREIGN KEY (registry_id)
    REFERENCES civic_registry_configurations(registry_id)
    ON DELETE CASCADE,
  CONSTRAINT civic_registry_integrity_heads_hash_check
    CHECK (
      (
        sequence = 0
        AND head_hash IS NULL
      )
      OR (
        sequence > 0
        AND head_hash ~ '^[0-9a-f]{64}$'
      )
    )
);

CREATE TABLE IF NOT EXISTS civic_registry_integrity_entries (
  registry_id TEXT NOT NULL,
  sequence BIGINT NOT NULL CHECK (sequence > 0),
  source_table TEXT NOT NULL CHECK (
    source_table IN ('record_version', 'audit_event')
  ),
  source_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK (
    payload_hash ~ '^[0-9a-f]{64}$'
  ),
  previous_hash TEXT CHECK (
    previous_hash IS NULL
    OR previous_hash ~ '^[0-9a-f]{64}$'
  ),
  entry_hash TEXT NOT NULL CHECK (
    entry_hash ~ '^[0-9a-f]{64}$'
  ),
  occurred_at TIMESTAMPTZ NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (registry_id, sequence),
  CONSTRAINT civic_registry_integrity_entries_registry_fk
    FOREIGN KEY (registry_id)
    REFERENCES civic_registry_configurations(registry_id)
    ON DELETE CASCADE,
  CONSTRAINT civic_registry_integrity_entries_source_unique
    UNIQUE (registry_id, source_table, source_key)
);

CREATE INDEX IF NOT EXISTS
  civic_registry_integrity_entries_source_idx
  ON civic_registry_integrity_entries (
    registry_id,
    source_table,
    source_key
  );

CREATE INDEX IF NOT EXISTS
  civic_registry_integrity_entries_recent_idx
  ON civic_registry_integrity_entries (
    registry_id,
    sequence DESC
  );

CREATE OR REPLACE FUNCTION civic_registry_integrity_frame(
  value TEXT
)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT CASE
    WHEN value IS NULL THEN '-1:'
    ELSE
      octet_length(convert_to(value, 'UTF8'))::text
      || ':'
      || value
  END;
$$;

CREATE OR REPLACE FUNCTION civic_registry_integrity_sha256(
  value TEXT
)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT encode(
    digest(
      convert_to(value, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
$$;

CREATE OR REPLACE FUNCTION civic_registry_integrity_entry_hash(
  registry_value TEXT,
  sequence_value BIGINT,
  source_table_value TEXT,
  source_key_value TEXT,
  payload_hash_value TEXT,
  previous_hash_value TEXT
)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT civic_registry_integrity_sha256(
    'civic-registry-integrity-v1'
    || '|'
    || civic_registry_integrity_frame(
      registry_value
    )
    || '|'
    || civic_registry_integrity_frame(
      sequence_value::text
    )
    || '|'
    || civic_registry_integrity_frame(
      source_table_value
    )
    || '|'
    || civic_registry_integrity_frame(
      source_key_value
    )
    || '|'
    || civic_registry_integrity_frame(
      payload_hash_value
    )
    || '|'
    || civic_registry_integrity_frame(
      previous_hash_value
    )
  );
$$;

CREATE OR REPLACE FUNCTION
  civic_registry_record_version_integrity_payload(
    registry_value TEXT,
    record_value TEXT,
    version_value INTEGER,
    operation_value TEXT,
    visibility_value TEXT,
    snapshot_value JSONB,
    created_at_value TIMESTAMPTZ,
    actor_value TEXT,
    reason_value TEXT
  )
RETURNS JSONB
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'schema',
      'civic-registry-record-version-v1',
    'registryId', registry_value,
    'recordId', record_value,
    'version', version_value,
    'operation', operation_value,
    'visibility', visibility_value,
    'snapshot', snapshot_value,
    'createdAt', created_at_value,
    'actorId', actor_value,
    'reason', reason_value
  );
$$;

CREATE OR REPLACE FUNCTION
  civic_registry_audit_event_integrity_payload(
    id_value BIGINT,
    registry_value TEXT,
    subject_type_value TEXT,
    subject_id_value TEXT,
    event_type_value TEXT,
    occurred_at_value TIMESTAMPTZ,
    visibility_value TEXT,
    actor_value TEXT,
    reason_value TEXT,
    metadata_value JSONB
  )
RETURNS JSONB
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'schema',
      'civic-registry-audit-event-v1',
    'id', id_value::text,
    'registryId', registry_value,
    'subjectType', subject_type_value,
    'subjectId', subject_id_value,
    'eventType', event_type_value,
    'occurredAt', occurred_at_value,
    'visibility', visibility_value,
    'actorId', actor_value,
    'reason', reason_value,
    'metadata',
      COALESCE(metadata_value, '{}'::jsonb)
  );
$$;

CREATE OR REPLACE VIEW
  civic_registry_integrity_sources
AS
  SELECT
    version.registry_id,
    'record_version'::text AS source_table,
    version.record_id
      || ':v'
      || version.version::text AS source_key,
    version.created_at AS occurred_at,
    civic_registry_record_version_integrity_payload(
      version.registry_id,
      version.record_id,
      version.version,
      version.operation,
      version.visibility,
      version.snapshot,
      version.created_at,
      version.actor_id,
      version.reason
    ) AS payload
  FROM civic_registry_record_versions AS version

  UNION ALL

  SELECT
    event.registry_id,
    'audit_event'::text AS source_table,
    event.id::text AS source_key,
    event.occurred_at,
    civic_registry_audit_event_integrity_payload(
      event.id,
      event.registry_id,
      event.subject_type,
      event.subject_id,
      event.event_type,
      event.occurred_at,
      event.visibility,
      event.actor_id,
      event.reason,
      event.metadata
    ) AS payload
  FROM civic_registry_audit_events AS event;

CREATE OR REPLACE FUNCTION
  civic_registry_integrity_writer_enabled()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  SELECT COALESCE(
    current_setting(
      'civic_registry.integrity_writer',
      true
    ),
    ''
  ) = 'on';
$$;

CREATE OR REPLACE FUNCTION
  civic_registry_guard_integrity_storage()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  registry_value TEXT;
BEGIN
  registry_value := CASE
    WHEN TG_OP = 'DELETE'
      THEN OLD.registry_id
    ELSE NEW.registry_id
  END;

  IF TG_OP = 'DELETE' AND NOT EXISTS (
    SELECT 1
    FROM civic_registry_configurations
    WHERE registry_id = registry_value
  ) THEN
    RETURN OLD;
  END IF;

  IF NOT civic_registry_integrity_writer_enabled() THEN
    RAISE EXCEPTION
      'Civic Registry integrity storage is managed internally; direct % on % is not permitted.',
      TG_OP,
      TG_TABLE_NAME
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS
  civic_registry_integrity_entries_guard
  ON civic_registry_integrity_entries;

CREATE TRIGGER civic_registry_integrity_entries_guard
BEFORE INSERT OR UPDATE OR DELETE
ON civic_registry_integrity_entries
FOR EACH ROW
EXECUTE FUNCTION
  civic_registry_guard_integrity_storage();

DROP TRIGGER IF EXISTS
  civic_registry_integrity_heads_guard
  ON civic_registry_integrity_heads;

CREATE TRIGGER civic_registry_integrity_heads_guard
BEFORE INSERT OR UPDATE OR DELETE
ON civic_registry_integrity_heads
FOR EACH ROW
EXECUTE FUNCTION
  civic_registry_guard_integrity_storage();

CREATE OR REPLACE FUNCTION
  civic_registry_append_integrity_entry(
    registry_value TEXT,
    source_table_value TEXT,
    source_key_value TEXT,
    payload_value JSONB,
    occurred_at_value TIMESTAMPTZ
  )
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  current_sequence BIGINT;
  current_hash TEXT;
  next_sequence BIGINT;
  payload_hash_value TEXT;
  entry_hash_value TEXT;
BEGIN
  IF source_table_value NOT IN (
    'record_version',
    'audit_event'
  ) THEN
    RAISE EXCEPTION
      'Unsupported integrity source table: %.',
      source_table_value
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    724918533,
    hashtext(registry_value)
  );

  PERFORM set_config(
    'civic_registry.integrity_writer',
    'on',
    true
  );

  INSERT INTO civic_registry_integrity_heads (
    registry_id,
    sequence,
    head_hash,
    updated_at
  )
  VALUES (
    registry_value,
    0,
    NULL,
    NOW()
  )
  ON CONFLICT (registry_id)
  DO NOTHING;

  SELECT
    head.sequence,
    head.head_hash
  INTO
    current_sequence,
    current_hash
  FROM civic_registry_integrity_heads AS head
  WHERE head.registry_id = registry_value
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Integrity head for registry % could not be initialized.',
      registry_value
      USING ERRCODE = '55000';
  END IF;

  next_sequence := current_sequence + 1;
  payload_hash_value :=
    civic_registry_integrity_sha256(
      payload_value::text
    );
  entry_hash_value :=
    civic_registry_integrity_entry_hash(
      registry_value,
      next_sequence,
      source_table_value,
      source_key_value,
      payload_hash_value,
      current_hash
    );

  INSERT INTO civic_registry_integrity_entries (
    registry_id,
    sequence,
    source_table,
    source_key,
    payload_hash,
    previous_hash,
    entry_hash,
    occurred_at,
    captured_at
  )
  VALUES (
    registry_value,
    next_sequence,
    source_table_value,
    source_key_value,
    payload_hash_value,
    current_hash,
    entry_hash_value,
    occurred_at_value,
    NOW()
  );

  UPDATE civic_registry_integrity_heads
  SET
    sequence = next_sequence,
    head_hash = entry_hash_value,
    updated_at = NOW()
  WHERE registry_id = registry_value;

  PERFORM set_config(
    'civic_registry.integrity_writer',
    'off',
    true
  );

  RETURN entry_hash_value;
END;
$$;

DO $$
DECLARE
  source_row RECORD;
BEGIN
  FOR source_row IN
    SELECT
      source.registry_id,
      source.source_table,
      source.source_key,
      source.payload,
      source.occurred_at
    FROM civic_registry_integrity_sources
      AS source
    LEFT JOIN civic_registry_integrity_entries
      AS entry
      ON entry.registry_id =
          source.registry_id
      AND entry.source_table =
          source.source_table
      AND entry.source_key =
          source.source_key
    WHERE entry.sequence IS NULL
    ORDER BY
      source.registry_id ASC,
      source.occurred_at ASC,
      source.source_table ASC,
      source.source_key ASC
  LOOP
    PERFORM civic_registry_append_integrity_entry(
      source_row.registry_id,
      source_row.source_table,
      source_row.source_key,
      source_row.payload,
      source_row.occurred_at
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION
  civic_registry_capture_record_version_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM civic_registry_append_integrity_entry(
    NEW.registry_id,
    'record_version',
    NEW.record_id
      || ':v'
      || NEW.version::text,
    civic_registry_record_version_integrity_payload(
      NEW.registry_id,
      NEW.record_id,
      NEW.version,
      NEW.operation,
      NEW.visibility,
      NEW.snapshot,
      NEW.created_at,
      NEW.actor_id,
      NEW.reason
    ),
    NEW.created_at
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS
  civic_registry_record_version_integrity_trigger
  ON civic_registry_record_versions;

CREATE TRIGGER
  civic_registry_record_version_integrity_trigger
AFTER INSERT
ON civic_registry_record_versions
FOR EACH ROW
EXECUTE FUNCTION
  civic_registry_capture_record_version_integrity();

CREATE OR REPLACE FUNCTION
  civic_registry_capture_audit_event_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM civic_registry_append_integrity_entry(
    NEW.registry_id,
    'audit_event',
    NEW.id::text,
    civic_registry_audit_event_integrity_payload(
      NEW.id,
      NEW.registry_id,
      NEW.subject_type,
      NEW.subject_id,
      NEW.event_type,
      NEW.occurred_at,
      NEW.visibility,
      NEW.actor_id,
      NEW.reason,
      NEW.metadata
    ),
    NEW.occurred_at
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS
  civic_registry_audit_event_integrity_trigger
  ON civic_registry_audit_events;

CREATE TRIGGER
  civic_registry_audit_event_integrity_trigger
AFTER INSERT
ON civic_registry_audit_events
FOR EACH ROW
EXECUTE FUNCTION
  civic_registry_capture_audit_event_integrity();

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
SELECT
  config.registry_id,
  'registry',
  config.registry_id,
  'integrity.history_initialized',
  NOW(),
  'private',
  'system:audit-integrity-migration',
  'Cryptographic integrity chaining initialized over existing immutable history.',
  jsonb_build_object(
    'algorithm', 'sha256',
    'chainFormat',
      'civic-registry-integrity-v1'
  )
FROM civic_registry_configurations AS config
WHERE NOT EXISTS (
  SELECT 1
  FROM civic_registry_audit_events AS event
  WHERE event.registry_id = config.registry_id
    AND event.subject_type = 'registry'
    AND event.subject_id = config.registry_id
    AND event.event_type =
      'integrity.history_initialized'
);
