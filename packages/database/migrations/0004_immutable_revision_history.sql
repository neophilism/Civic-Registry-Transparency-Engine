CREATE TABLE IF NOT EXISTS civic_registry_record_versions (
  registry_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  operation TEXT NOT NULL CHECK (
    operation IN ('baseline', 'created', 'updated', 'deleted')
  ),
  visibility TEXT NOT NULL CHECK (
    visibility IN ('public', 'restricted', 'private', 'embargoed')
  ),
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  actor_id TEXT,
  reason TEXT,
  PRIMARY KEY (registry_id, record_id, version),
  CONSTRAINT civic_registry_record_versions_registry_fk
    FOREIGN KEY (registry_id)
    REFERENCES civic_registry_configurations(registry_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS civic_registry_record_versions_record_idx
  ON civic_registry_record_versions (
    registry_id,
    record_id,
    version DESC
  );

CREATE INDEX IF NOT EXISTS civic_registry_record_versions_visibility_idx
  ON civic_registry_record_versions (
    registry_id,
    record_id,
    visibility,
    version DESC
  );

CREATE TABLE IF NOT EXISTS civic_registry_audit_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  registry_id TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  visibility TEXT NOT NULL CHECK (
    visibility IN ('public', 'restricted', 'private', 'embargoed')
  ),
  actor_id TEXT,
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT civic_registry_audit_events_registry_fk
    FOREIGN KEY (registry_id)
    REFERENCES civic_registry_configurations(registry_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS civic_registry_audit_events_subject_idx
  ON civic_registry_audit_events (
    registry_id,
    subject_type,
    subject_id,
    occurred_at DESC,
    id DESC
  );

CREATE INDEX IF NOT EXISTS civic_registry_audit_events_visibility_idx
  ON civic_registry_audit_events (
    registry_id,
    subject_type,
    subject_id,
    visibility,
    occurred_at DESC
  );

CREATE OR REPLACE FUNCTION civic_registry_record_snapshot(
  record_row civic_registry_records
)
RETURNS JSONB
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT jsonb_strip_nulls(
    jsonb_build_object(
      'id', record_row.id,
      'registryId', record_row.registry_id,
      'recordTypeId', record_row.record_type_id,
      'fields', record_row.fields,
      'status', record_row.status,
      'visibility', record_row.visibility,
      'externalIdentifiers', record_row.external_identifiers,
      'tags', to_jsonb(record_row.tags),
      'createdAt', record_row.created_at,
      'updatedAt', record_row.updated_at,
      'publishedAt', record_row.published_at
    )
  );
$$;

CREATE OR REPLACE FUNCTION civic_registry_changed_field_ids(
  old_fields JSONB,
  new_fields JSONB
)
RETURNS JSONB
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT COALESCE(
    jsonb_agg(changed.key ORDER BY changed.key),
    '[]'::jsonb
  )
  FROM (
    SELECT keys.key
    FROM (
      SELECT jsonb_object_keys(
        COALESCE(old_fields, '{}'::jsonb)
      ) AS key
      UNION
      SELECT jsonb_object_keys(
        COALESCE(new_fields, '{}'::jsonb)
      ) AS key
    ) AS keys
    WHERE
      COALESCE(old_fields, '{}'::jsonb) -> keys.key
      IS DISTINCT FROM
      COALESCE(new_fields, '{}'::jsonb) -> keys.key
  ) AS changed;
$$;

CREATE OR REPLACE FUNCTION civic_registry_history_setting(
  setting_name TEXT
)
RETURNS TEXT
LANGUAGE SQL
STABLE
AS $$
  SELECT NULLIF(
    current_setting(setting_name, true),
    ''
  );
$$;

CREATE OR REPLACE FUNCTION civic_registry_prevent_history_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'Civic Registry history is immutable; % on % is not permitted.',
    TG_OP,
    TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS civic_registry_record_versions_immutable
  ON civic_registry_record_versions;

CREATE TRIGGER civic_registry_record_versions_immutable
BEFORE UPDATE OR DELETE
ON civic_registry_record_versions
FOR EACH ROW
EXECUTE FUNCTION civic_registry_prevent_history_mutation();

DROP TRIGGER IF EXISTS civic_registry_audit_events_immutable
  ON civic_registry_audit_events;

CREATE TRIGGER civic_registry_audit_events_immutable
BEFORE UPDATE OR DELETE
ON civic_registry_audit_events
FOR EACH ROW
EXECUTE FUNCTION civic_registry_prevent_history_mutation();

INSERT INTO civic_registry_record_versions (
  registry_id,
  record_id,
  version,
  operation,
  visibility,
  snapshot,
  created_at,
  actor_id,
  reason
)
SELECT
  record.registry_id,
  record.id,
  1,
  'baseline',
  record.visibility,
  civic_registry_record_snapshot(record),
  NOW(),
  NULL,
  'History tracking initialized for a pre-existing record.'
FROM civic_registry_records AS record
WHERE NOT EXISTS (
  SELECT 1
  FROM civic_registry_record_versions AS version
  WHERE version.registry_id = record.registry_id
    AND version.record_id = record.id
);

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
  record.registry_id,
  'record',
  record.id,
  'record.history_initialized',
  NOW(),
  record.visibility,
  NULL,
  'History tracking initialized for a pre-existing record.',
  jsonb_build_object('version', 1)
FROM civic_registry_records AS record
WHERE NOT EXISTS (
  SELECT 1
  FROM civic_registry_audit_events AS event
  WHERE event.registry_id = record.registry_id
    AND event.subject_type = 'record'
    AND event.subject_id = record.id
    AND event.event_type = 'record.history_initialized'
);

CREATE OR REPLACE FUNCTION civic_registry_capture_record_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  history_row civic_registry_records;
  next_version INTEGER;
  operation_name TEXT;
  event_visibility TEXT;
  changed_fields JSONB;
  actor_value TEXT;
  reason_value TEXT;
  metadata_changed BOOLEAN;
  semantic_changed BOOLEAN;
BEGIN
  actor_value := civic_registry_history_setting(
    'civic_registry.actor_id'
  );
  reason_value := civic_registry_history_setting(
    'civic_registry.reason'
  );

  IF TG_OP = 'UPDATE' THEN
    semantic_changed :=
      OLD.record_type_id IS DISTINCT FROM NEW.record_type_id
      OR OLD.fields IS DISTINCT FROM NEW.fields
      OR OLD.status IS DISTINCT FROM NEW.status
      OR OLD.visibility IS DISTINCT FROM NEW.visibility
      OR OLD.external_identifiers IS DISTINCT FROM NEW.external_identifiers
      OR OLD.tags IS DISTINCT FROM NEW.tags
      OR OLD.created_at IS DISTINCT FROM NEW.created_at
      OR OLD.published_at IS DISTINCT FROM NEW.published_at;

    IF NOT semantic_changed THEN
      RETURN NEW;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    history_row := OLD;
    operation_name := 'deleted';
    event_visibility := OLD.visibility;
  ELSIF TG_OP = 'INSERT' THEN
    history_row := NEW;
    operation_name := 'created';
    event_visibility := NEW.visibility;
  ELSE
    history_row := NEW;
    operation_name := 'updated';
    event_visibility := CASE
      WHEN OLD.visibility = 'public'
        AND NEW.visibility = 'public'
      THEN 'public'
      ELSE 'private'
    END;
  END IF;

  SELECT COALESCE(MAX(version), 0) + 1
  INTO next_version
  FROM civic_registry_record_versions
  WHERE registry_id = history_row.registry_id
    AND record_id = history_row.id;

  INSERT INTO civic_registry_record_versions (
    registry_id,
    record_id,
    version,
    operation,
    visibility,
    snapshot,
    created_at,
    actor_id,
    reason
  )
  VALUES (
    history_row.registry_id,
    history_row.id,
    next_version,
    operation_name,
    history_row.visibility,
    civic_registry_record_snapshot(history_row),
    NOW(),
    actor_value,
    reason_value
  );

  IF TG_OP = 'INSERT' THEN
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
      NEW.registry_id,
      'record',
      NEW.id,
      'record.created',
      NEW.created_at,
      NEW.visibility,
      actor_value,
      reason_value,
      jsonb_build_object(
        'version', next_version,
        'recordTypeId', NEW.record_type_id
      )
    );

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
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
      OLD.registry_id,
      'record',
      OLD.id,
      'record.deleted',
      NOW(),
      OLD.visibility,
      actor_value,
      reason_value,
      jsonb_build_object(
        'version', next_version,
        'recordTypeId', OLD.record_type_id
      )
    );

    RETURN OLD;
  END IF;

  changed_fields := civic_registry_changed_field_ids(
    OLD.fields,
    NEW.fields
  );

  IF jsonb_array_length(changed_fields) > 0 THEN
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
      NEW.registry_id,
      'record',
      NEW.id,
      'record.fields_changed',
      NOW(),
      event_visibility,
      actor_value,
      reason_value,
      jsonb_build_object(
        'version', next_version,
        'changedFieldIds', changed_fields
      )
    );
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status THEN
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
      NEW.registry_id,
      'record',
      NEW.id,
      CASE
        WHEN LOWER(NEW.status) = 'published'
          THEN 'record.published'
        WHEN LOWER(NEW.status) = 'withdrawn'
          THEN 'record.withdrawn'
        ELSE 'record.status_changed'
      END,
      NOW(),
      event_visibility,
      actor_value,
      reason_value,
      jsonb_build_object(
        'version', next_version,
        'fromStatus', OLD.status,
        'toStatus', NEW.status
      )
    );
  END IF;

  IF OLD.visibility IS DISTINCT FROM NEW.visibility THEN
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
      NEW.registry_id,
      'record',
      NEW.id,
      'record.visibility_changed',
      NOW(),
      event_visibility,
      actor_value,
      reason_value,
      jsonb_build_object(
        'version', next_version,
        'fromVisibility', OLD.visibility,
        'toVisibility', NEW.visibility
      )
    );
  END IF;

  metadata_changed :=
    OLD.record_type_id IS DISTINCT FROM NEW.record_type_id
    OR OLD.external_identifiers IS DISTINCT FROM NEW.external_identifiers
    OR OLD.tags IS DISTINCT FROM NEW.tags
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR OLD.published_at IS DISTINCT FROM NEW.published_at;

  IF metadata_changed THEN
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
      NEW.registry_id,
      'record',
      NEW.id,
      'record.metadata_changed',
      NOW(),
      event_visibility,
      actor_value,
      reason_value,
      jsonb_strip_nulls(
        jsonb_build_object(
          'version', next_version,
          'recordTypeChanged',
            OLD.record_type_id IS DISTINCT FROM NEW.record_type_id,
          'externalIdentifiersChanged',
            OLD.external_identifiers IS DISTINCT FROM NEW.external_identifiers,
          'tagsChanged',
            OLD.tags IS DISTINCT FROM NEW.tags,
          'createdAtChanged',
            OLD.created_at IS DISTINCT FROM NEW.created_at,
          'publishedAtChanged',
            OLD.published_at IS DISTINCT FROM NEW.published_at
        )
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS civic_registry_record_history_trigger
  ON civic_registry_records;

CREATE TRIGGER civic_registry_record_history_trigger
AFTER INSERT OR UPDATE OR DELETE
ON civic_registry_records
FOR EACH ROW
EXECUTE FUNCTION civic_registry_capture_record_history();

CREATE OR REPLACE FUNCTION civic_registry_relationship_event_visibility(
  registry_value TEXT,
  from_record_value TEXT,
  to_record_value TEXT
)
RETURNS TEXT
LANGUAGE SQL
STABLE
AS $$
  SELECT CASE
    WHEN COUNT(*) = 2
      AND BOOL_AND(visibility = 'public')
      THEN 'public'
    ELSE 'private'
  END
  FROM civic_registry_records
  WHERE registry_id = registry_value
    AND id = ANY(
      ARRAY[from_record_value, to_record_value]::TEXT[]
    );
$$;

CREATE OR REPLACE FUNCTION civic_registry_insert_relationship_event(
  relationship_row civic_registry_relationships,
  event_name TEXT,
  occurred_value TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  visibility_value TEXT;
BEGIN
  visibility_value := civic_registry_relationship_event_visibility(
    relationship_row.registry_id,
    relationship_row.from_record_id,
    relationship_row.to_record_id
  );

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
  VALUES
  (
    relationship_row.registry_id,
    'record',
    relationship_row.from_record_id,
    event_name,
    occurred_value,
    visibility_value,
    civic_registry_history_setting('civic_registry.actor_id'),
    civic_registry_history_setting('civic_registry.reason'),
    jsonb_build_object(
      'relationshipId', relationship_row.id,
      'relationshipTypeId',
        relationship_row.relationship_type_id,
      'direction', 'outbound',
      'otherRecordId', relationship_row.to_record_id
    )
  ),
  (
    relationship_row.registry_id,
    'record',
    relationship_row.to_record_id,
    event_name,
    occurred_value,
    visibility_value,
    civic_registry_history_setting('civic_registry.actor_id'),
    civic_registry_history_setting('civic_registry.reason'),
    jsonb_build_object(
      'relationshipId', relationship_row.id,
      'relationshipTypeId',
        relationship_row.relationship_type_id,
      'direction', 'inbound',
      'otherRecordId', relationship_row.from_record_id
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION civic_registry_capture_relationship_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM civic_registry_insert_relationship_event(
      NEW,
      'relationship.added',
      NEW.created_at
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM civic_registry_insert_relationship_event(
      OLD,
      'relationship.removed',
      NOW()
    );
    RETURN OLD;
  END IF;

  IF
    OLD.relationship_type_id IS DISTINCT FROM NEW.relationship_type_id
    OR OLD.from_record_id IS DISTINCT FROM NEW.from_record_id
    OR OLD.to_record_id IS DISTINCT FROM NEW.to_record_id
    OR OLD.metadata IS DISTINCT FROM NEW.metadata
  THEN
    PERFORM civic_registry_insert_relationship_event(
      OLD,
      'relationship.removed',
      NOW()
    );
    PERFORM civic_registry_insert_relationship_event(
      NEW,
      'relationship.added',
      NOW()
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS civic_registry_relationship_history_trigger
  ON civic_registry_relationships;

CREATE TRIGGER civic_registry_relationship_history_trigger
AFTER INSERT OR UPDATE OR DELETE
ON civic_registry_relationships
FOR EACH ROW
EXECUTE FUNCTION civic_registry_capture_relationship_history();

CREATE OR REPLACE FUNCTION civic_registry_citation_event_visibility(
  registry_value TEXT,
  record_value TEXT,
  citation_visibility TEXT,
  source_value TEXT,
  document_value TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  record_visibility TEXT;
  document_visibility TEXT;
  document_source TEXT;
  source_visibility TEXT;
  resolved_source TEXT;
BEGIN
  IF citation_visibility <> 'public' THEN
    RETURN 'private';
  END IF;

  SELECT visibility
  INTO record_visibility
  FROM civic_registry_records
  WHERE registry_id = registry_value
    AND id = record_value;

  IF record_visibility IS DISTINCT FROM 'public' THEN
    RETURN 'private';
  END IF;

  IF document_value IS NOT NULL THEN
    SELECT visibility, source_id
    INTO document_visibility, document_source
    FROM civic_registry_documents
    WHERE registry_id = registry_value
      AND id = document_value;

    IF document_visibility IS DISTINCT FROM 'public' THEN
      RETURN 'private';
    END IF;
  END IF;

  resolved_source := COALESCE(
    source_value,
    document_source
  );

  IF resolved_source IS NOT NULL THEN
    SELECT visibility
    INTO source_visibility
    FROM civic_registry_sources
    WHERE registry_id = registry_value
      AND id = resolved_source;

    IF source_visibility IS DISTINCT FROM 'public' THEN
      RETURN 'private';
    END IF;
  END IF;

  RETURN 'public';
END;
$$;

CREATE OR REPLACE FUNCTION civic_registry_insert_citation_event(
  citation_row civic_registry_citations,
  event_name TEXT,
  visibility_value TEXT,
  occurred_value TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
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
    citation_row.registry_id,
    'record',
    citation_row.record_id,
    event_name,
    occurred_value,
    visibility_value,
    civic_registry_history_setting('civic_registry.actor_id'),
    civic_registry_history_setting('civic_registry.reason'),
    jsonb_strip_nulls(
      jsonb_build_object(
        'citationId', citation_row.id,
        'fieldId', citation_row.field_id,
        'sourceId', citation_row.source_id,
        'documentId', citation_row.document_id,
        'locator', citation_row.locator
      )
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION civic_registry_capture_citation_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  old_visibility TEXT;
  new_visibility TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    new_visibility := civic_registry_citation_event_visibility(
      NEW.registry_id,
      NEW.record_id,
      NEW.visibility,
      NEW.source_id,
      NEW.document_id
    );

    PERFORM civic_registry_insert_citation_event(
      NEW,
      'evidence.citation_added',
      new_visibility,
      NEW.created_at
    );

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    old_visibility := civic_registry_citation_event_visibility(
      OLD.registry_id,
      OLD.record_id,
      OLD.visibility,
      OLD.source_id,
      OLD.document_id
    );

    PERFORM civic_registry_insert_citation_event(
      OLD,
      'evidence.citation_removed',
      old_visibility,
      NOW()
    );

    RETURN OLD;
  END IF;

  old_visibility := civic_registry_citation_event_visibility(
    OLD.registry_id,
    OLD.record_id,
    OLD.visibility,
    OLD.source_id,
    OLD.document_id
  );
  new_visibility := civic_registry_citation_event_visibility(
    NEW.registry_id,
    NEW.record_id,
    NEW.visibility,
    NEW.source_id,
    NEW.document_id
  );

  IF OLD.record_id IS DISTINCT FROM NEW.record_id THEN
    PERFORM civic_registry_insert_citation_event(
      OLD,
      'evidence.citation_removed',
      old_visibility,
      NOW()
    );
    PERFORM civic_registry_insert_citation_event(
      NEW,
      'evidence.citation_added',
      new_visibility,
      NOW()
    );
    RETURN NEW;
  END IF;

  IF old_visibility = 'public'
    AND new_visibility <> 'public'
  THEN
    PERFORM civic_registry_insert_citation_event(
      OLD,
      'evidence.citation_removed',
      'public',
      NOW()
    );
    RETURN NEW;
  END IF;

  IF old_visibility <> 'public'
    AND new_visibility = 'public'
  THEN
    PERFORM civic_registry_insert_citation_event(
      NEW,
      'evidence.citation_added',
      'public',
      NOW()
    );
    RETURN NEW;
  END IF;

  PERFORM civic_registry_insert_citation_event(
    NEW,
    'evidence.citation_updated',
    CASE
      WHEN old_visibility = 'public'
        AND new_visibility = 'public'
      THEN 'public'
      ELSE 'private'
    END,
    NOW()
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS civic_registry_citation_history_trigger
  ON civic_registry_citations;

CREATE TRIGGER civic_registry_citation_history_trigger
AFTER INSERT OR UPDATE OR DELETE
ON civic_registry_citations
FOR EACH ROW
EXECUTE FUNCTION civic_registry_capture_citation_history();
