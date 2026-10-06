CREATE TABLE IF NOT EXISTS civic_registry_record_disclosures (
  registry_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  disposition TEXT NOT NULL CHECK (
    disposition IN ('disclosed', 'withheld')
  ),
  reason TEXT,
  authority TEXT,
  public_note TEXT,
  updated_at TIMESTAMPTZ NOT NULL,
  actor_id TEXT,
  PRIMARY KEY (registry_id, record_id),
  CONSTRAINT civic_registry_record_disclosures_record_fk
    FOREIGN KEY (registry_id, record_id)
    REFERENCES civic_registry_records(registry_id, id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS civic_registry_field_disclosures (
  registry_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  field_id TEXT NOT NULL,
  disposition TEXT NOT NULL CHECK (
    disposition IN ('redacted', 'withheld')
  ),
  replacement_text TEXT,
  reason TEXT,
  authority TEXT,
  public_note TEXT,
  updated_at TIMESTAMPTZ NOT NULL,
  actor_id TEXT,
  PRIMARY KEY (registry_id, record_id, field_id),
  CONSTRAINT civic_registry_field_disclosures_record_fk
    FOREIGN KEY (registry_id, record_id)
    REFERENCES civic_registry_records(registry_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS
  civic_registry_field_disclosures_record_idx
  ON civic_registry_field_disclosures (
    registry_id,
    record_id
  );

CREATE TABLE IF NOT EXISTS civic_registry_document_disclosures (
  registry_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  disposition TEXT NOT NULL CHECK (
    disposition IN ('disclosed', 'redacted', 'withheld')
  ),
  public_canonical_url TEXT,
  public_storage_key TEXT,
  reason TEXT,
  authority TEXT,
  public_note TEXT,
  updated_at TIMESTAMPTZ NOT NULL,
  actor_id TEXT,
  PRIMARY KEY (registry_id, document_id),
  CONSTRAINT civic_registry_document_disclosures_document_fk
    FOREIGN KEY (registry_id, document_id)
    REFERENCES civic_registry_documents(registry_id, id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS civic_registry_document_redactions (
  registry_id TEXT NOT NULL,
  id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  locator JSONB NOT NULL DEFAULT '{}'::jsonb,
  replacement_text TEXT,
  reason TEXT,
  authority TEXT,
  public_note TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  actor_id TEXT,
  PRIMARY KEY (registry_id, id),
  CONSTRAINT civic_registry_document_redactions_document_fk
    FOREIGN KEY (registry_id, document_id)
    REFERENCES civic_registry_documents(registry_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS
  civic_registry_document_redactions_document_idx
  ON civic_registry_document_redactions (
    registry_id,
    document_id,
    created_at
  );

ALTER TABLE civic_registry_records
  ADD COLUMN IF NOT EXISTS public_fields JSONB
  NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE civic_registry_records
  ADD COLUMN IF NOT EXISTS public_search_text TEXT
  NOT NULL DEFAULT '';

ALTER TABLE civic_registry_records
  ADD COLUMN IF NOT EXISTS public_search_document TSVECTOR
  GENERATED ALWAYS AS (
    to_tsvector(
      'simple',
      COALESCE(public_search_text, '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS
  civic_registry_records_public_fields_gin_idx
  ON civic_registry_records USING GIN (public_fields);

CREATE INDEX IF NOT EXISTS
  civic_registry_records_public_search_document_idx
  ON civic_registry_records USING GIN (
    public_search_document
  );

CREATE OR REPLACE FUNCTION civic_registry_disclosure_text(
  registry_value TEXT,
  config_key TEXT,
  fallback_value TEXT
)
RETURNS TEXT
LANGUAGE SQL
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(
      config -> 'disclosure' ->> config_key,
      ''
    ),
    fallback_value
  )
  FROM civic_registry_configurations
  WHERE registry_id = registry_value;
$$;

CREATE OR REPLACE FUNCTION civic_registry_public_record_fields(
  registry_value TEXT,
  record_value TEXT,
  source_fields JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  result_fields JSONB :=
    COALESCE(source_fields, '{}'::jsonb);
  record_disposition TEXT;
  field_rule RECORD;
BEGIN
  SELECT disposition
  INTO record_disposition
  FROM civic_registry_record_disclosures
  WHERE registry_id = registry_value
    AND record_id = record_value;

  IF record_disposition = 'withheld' THEN
    RETURN '{}'::jsonb;
  END IF;

  FOR field_rule IN
    SELECT field_id
    FROM civic_registry_field_disclosures
    WHERE registry_id = registry_value
      AND record_id = record_value
  LOOP
    result_fields :=
      result_fields - field_rule.field_id;
  END LOOP;

  RETURN result_fields;
END;
$$;

CREATE OR REPLACE FUNCTION civic_registry_public_record_search_text(
  registry_value TEXT,
  record_value TEXT,
  record_type_value TEXT,
  tags_value TEXT[],
  fields_value JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  config_value JSONB;
  record_type_value_json JSONB;
  field_value JSONB;
  field_definition JSONB;
  result_text TEXT := record_value;
  tag_value TEXT;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM civic_registry_record_disclosures
    WHERE registry_id = registry_value
      AND record_id = record_value
      AND disposition = 'withheld'
  ) THEN
    RETURN record_value;
  END IF;

  FOREACH tag_value IN ARRAY
    COALESCE(tags_value, ARRAY[]::TEXT[])
  LOOP
    result_text :=
      result_text || E'\n' || tag_value;
  END LOOP;

  SELECT config
  INTO config_value
  FROM civic_registry_configurations
  WHERE registry_id = registry_value;

  SELECT candidate
  INTO record_type_value_json
  FROM jsonb_array_elements(
    COALESCE(
      config_value -> 'registry' -> 'recordTypes',
      '[]'::jsonb
    )
  ) AS candidate
  WHERE candidate ->> 'id' = record_type_value
  LIMIT 1;

  IF record_type_value_json IS NULL THEN
    RETURN result_text;
  END IF;

  FOR field_definition IN
    SELECT value
    FROM jsonb_array_elements(
      COALESCE(
        record_type_value_json -> 'fields',
        '[]'::jsonb
      )
    )
  LOOP
    IF COALESCE(
      (field_definition ->> 'searchable')::boolean,
      false
    ) THEN
      field_value :=
        fields_value -> (field_definition ->> 'id');

      IF
        field_value IS NOT NULL
        AND field_value <> 'null'::jsonb
      THEN
        result_text :=
          result_text ||
          E'\n' ||
          CASE
            WHEN jsonb_typeof(field_value) = 'string'
            THEN field_value #>> '{}'
            ELSE field_value::text
          END;
      END IF;
    END IF;
  END LOOP;

  RETURN result_text;
END;
$$;

CREATE OR REPLACE FUNCTION civic_registry_apply_public_projection()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.public_fields :=
    civic_registry_public_record_fields(
      NEW.registry_id,
      NEW.id,
      NEW.fields
    );

  NEW.public_search_text :=
    civic_registry_public_record_search_text(
      NEW.registry_id,
      NEW.id,
      NEW.record_type_id,
      NEW.tags,
      NEW.public_fields
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS
  civic_registry_public_projection_record_trigger
  ON civic_registry_records;

CREATE TRIGGER civic_registry_public_projection_record_trigger
BEFORE INSERT OR UPDATE
ON civic_registry_records
FOR EACH ROW
EXECUTE FUNCTION civic_registry_apply_public_projection();

CREATE OR REPLACE FUNCTION civic_registry_refresh_public_projection(
  registry_value TEXT,
  record_value TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  projected_fields JSONB;
BEGIN
  SELECT civic_registry_public_record_fields(
    registry_id,
    id,
    fields
  )
  INTO projected_fields
  FROM civic_registry_records
  WHERE registry_id = registry_value
    AND id = record_value;

  IF projected_fields IS NULL THEN
    RETURN;
  END IF;

  UPDATE civic_registry_records
  SET
    public_fields = projected_fields,
    public_search_text =
      civic_registry_public_record_search_text(
        registry_id,
        id,
        record_type_id,
        tags,
        projected_fields
      )
  WHERE registry_id = registry_value
    AND id = record_value;
END;
$$;

CREATE OR REPLACE FUNCTION civic_registry_disclosure_event_visibility(
  registry_value TEXT,
  record_value TEXT
)
RETURNS TEXT
LANGUAGE SQL
STABLE
AS $$
  SELECT CASE
    WHEN visibility = 'public'
      THEN 'public'
    ELSE 'private'
  END
  FROM civic_registry_records
  WHERE registry_id = registry_value
    AND id = record_value;
$$;

CREATE OR REPLACE FUNCTION civic_registry_capture_record_disclosure()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  row_value civic_registry_record_disclosures;
  event_name TEXT;
  event_visibility TEXT;
BEGIN
  row_value := CASE
    WHEN TG_OP = 'DELETE' THEN OLD
    ELSE NEW
  END;

  PERFORM civic_registry_refresh_public_projection(
    row_value.registry_id,
    row_value.record_id
  );

  IF NOT EXISTS (
    SELECT 1
    FROM civic_registry_records
    WHERE registry_id = row_value.registry_id
      AND id = row_value.record_id
  ) THEN
    RETURN row_value;
  END IF;

  event_name := CASE
    WHEN TG_OP = 'DELETE'
      THEN 'disclosure.record_cleared'
    ELSE 'disclosure.record_changed'
  END;

  event_visibility :=
    civic_registry_disclosure_event_visibility(
      row_value.registry_id,
      row_value.record_id
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
  VALUES (
    row_value.registry_id,
    'record',
    row_value.record_id,
    event_name,
    NOW(),
    COALESCE(event_visibility, 'private'),
    COALESCE(
      row_value.actor_id,
      civic_registry_history_setting(
        'civic_registry.actor_id'
      )
    ),
    civic_registry_history_setting(
      'civic_registry.reason'
    ),
    jsonb_strip_nulls(
      jsonb_build_object(
        'disposition',
          CASE
            WHEN TG_OP = 'DELETE'
              THEN NULL
            ELSE row_value.disposition
          END,
        'reason', row_value.reason,
        'authority', row_value.authority,
        'publicNote', row_value.public_note
      )
    )
  );

  RETURN row_value;
END;
$$;

DROP TRIGGER IF EXISTS
  civic_registry_record_disclosure_trigger
  ON civic_registry_record_disclosures;

CREATE TRIGGER civic_registry_record_disclosure_trigger
AFTER INSERT OR UPDATE OR DELETE
ON civic_registry_record_disclosures
FOR EACH ROW
EXECUTE FUNCTION civic_registry_capture_record_disclosure();

CREATE OR REPLACE FUNCTION civic_registry_capture_field_disclosure()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  row_value civic_registry_field_disclosures;
  event_name TEXT;
  event_visibility TEXT;
BEGIN
  row_value := CASE
    WHEN TG_OP = 'DELETE' THEN OLD
    ELSE NEW
  END;

  PERFORM civic_registry_refresh_public_projection(
    row_value.registry_id,
    row_value.record_id
  );

  IF NOT EXISTS (
    SELECT 1
    FROM civic_registry_records
    WHERE registry_id = row_value.registry_id
      AND id = row_value.record_id
  ) THEN
    RETURN row_value;
  END IF;

  event_name := CASE
    WHEN TG_OP = 'DELETE'
      THEN 'disclosure.field_cleared'
    ELSE 'disclosure.field_changed'
  END;

  event_visibility :=
    civic_registry_disclosure_event_visibility(
      row_value.registry_id,
      row_value.record_id
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
  VALUES (
    row_value.registry_id,
    'record',
    row_value.record_id,
    event_name,
    NOW(),
    COALESCE(event_visibility, 'private'),
    COALESCE(
      row_value.actor_id,
      civic_registry_history_setting(
        'civic_registry.actor_id'
      )
    ),
    civic_registry_history_setting(
      'civic_registry.reason'
    ),
    jsonb_strip_nulls(
      jsonb_build_object(
        'fieldId', row_value.field_id,
        'disposition',
          CASE
            WHEN TG_OP = 'DELETE'
              THEN NULL
            ELSE row_value.disposition
          END,
        'replacementText',
          CASE
            WHEN TG_OP = 'DELETE'
              THEN NULL
            ELSE row_value.replacement_text
          END,
        'reason', row_value.reason,
        'authority', row_value.authority,
        'publicNote', row_value.public_note
      )
    )
  );

  RETURN row_value;
END;
$$;

DROP TRIGGER IF EXISTS
  civic_registry_field_disclosure_trigger
  ON civic_registry_field_disclosures;

CREATE TRIGGER civic_registry_field_disclosure_trigger
AFTER INSERT OR UPDATE OR DELETE
ON civic_registry_field_disclosures
FOR EACH ROW
EXECUTE FUNCTION civic_registry_capture_field_disclosure();

CREATE OR REPLACE FUNCTION civic_registry_capture_document_disclosure()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  row_value civic_registry_document_disclosures;
BEGIN
  row_value := CASE
    WHEN TG_OP = 'DELETE' THEN OLD
    ELSE NEW
  END;

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
    'document',
    row_value.document_id,
    CASE
      WHEN TG_OP = 'DELETE'
        THEN 'disclosure.document_cleared'
      ELSE 'disclosure.document_changed'
    END,
    NOW(),
    'private',
    COALESCE(
      row_value.actor_id,
      civic_registry_history_setting(
        'civic_registry.actor_id'
      )
    ),
    civic_registry_history_setting(
      'civic_registry.reason'
    ),
    jsonb_strip_nulls(
      jsonb_build_object(
        'disposition',
          CASE
            WHEN TG_OP = 'DELETE'
              THEN NULL
            ELSE row_value.disposition
          END,
        'reason', row_value.reason,
        'authority', row_value.authority,
        'publicNote', row_value.public_note
      )
    )
  );

  RETURN row_value;
END;
$$;

DROP TRIGGER IF EXISTS
  civic_registry_document_disclosure_trigger
  ON civic_registry_document_disclosures;

CREATE TRIGGER civic_registry_document_disclosure_trigger
AFTER INSERT OR UPDATE OR DELETE
ON civic_registry_document_disclosures
FOR EACH ROW
EXECUTE FUNCTION civic_registry_capture_document_disclosure();

CREATE OR REPLACE FUNCTION civic_registry_capture_document_redaction()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  row_value civic_registry_document_redactions;
BEGIN
  row_value := CASE
    WHEN TG_OP = 'DELETE' THEN OLD
    ELSE NEW
  END;

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
    'document',
    row_value.document_id,
    CASE
      WHEN TG_OP = 'INSERT'
        THEN 'disclosure.document_redaction_added'
      WHEN TG_OP = 'DELETE'
        THEN 'disclosure.document_redaction_removed'
      ELSE 'disclosure.document_redaction_changed'
    END,
    NOW(),
    'private',
    COALESCE(
      row_value.actor_id,
      civic_registry_history_setting(
        'civic_registry.actor_id'
      )
    ),
    civic_registry_history_setting(
      'civic_registry.reason'
    ),
    jsonb_strip_nulls(
      jsonb_build_object(
        'redactionId', row_value.id,
        'locator', row_value.locator,
        'reason', row_value.reason,
        'authority', row_value.authority,
        'publicNote', row_value.public_note
      )
    )
  );

  RETURN row_value;
END;
$$;

DROP TRIGGER IF EXISTS
  civic_registry_document_redaction_trigger
  ON civic_registry_document_redactions;

CREATE TRIGGER civic_registry_document_redaction_trigger
AFTER INSERT OR UPDATE OR DELETE
ON civic_registry_document_redactions
FOR EACH ROW
EXECUTE FUNCTION civic_registry_capture_document_redaction();

UPDATE civic_registry_records
SET
  public_fields =
    civic_registry_public_record_fields(
      registry_id,
      id,
      fields
    );

UPDATE civic_registry_records
SET
  public_search_text =
    civic_registry_public_record_search_text(
      registry_id,
      id,
      record_type_id,
      tags,
      public_fields
    );
