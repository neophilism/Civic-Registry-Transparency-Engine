CREATE TABLE IF NOT EXISTS civic_registry_configurations (
  registry_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  config JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS civic_registry_records (
  registry_id TEXT NOT NULL,
  id TEXT NOT NULL,
  record_type_id TEXT NOT NULL,
  fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (
    visibility IN ('public', 'restricted', 'private', 'embargoed')
  ),
  external_identifiers JSONB NOT NULL DEFAULT '[]'::jsonb,
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  published_at TIMESTAMPTZ,
  PRIMARY KEY (registry_id, id),
  CONSTRAINT civic_registry_records_registry_fk
    FOREIGN KEY (registry_id)
    REFERENCES civic_registry_configurations(registry_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS civic_registry_records_type_idx
  ON civic_registry_records (registry_id, record_type_id);

CREATE INDEX IF NOT EXISTS civic_registry_records_status_idx
  ON civic_registry_records (registry_id, status);

CREATE INDEX IF NOT EXISTS civic_registry_records_visibility_idx
  ON civic_registry_records (registry_id, visibility);

CREATE INDEX IF NOT EXISTS civic_registry_records_updated_idx
  ON civic_registry_records (registry_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS civic_registry_records_fields_gin_idx
  ON civic_registry_records USING GIN (fields);

CREATE INDEX IF NOT EXISTS civic_registry_records_tags_gin_idx
  ON civic_registry_records USING GIN (tags);

CREATE TABLE IF NOT EXISTS civic_registry_relationships (
  registry_id TEXT NOT NULL,
  id TEXT NOT NULL,
  relationship_type_id TEXT NOT NULL,
  from_record_id TEXT NOT NULL,
  to_record_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (registry_id, id),
  CONSTRAINT civic_registry_relationships_registry_fk
    FOREIGN KEY (registry_id)
    REFERENCES civic_registry_configurations(registry_id)
    ON DELETE CASCADE,
  CONSTRAINT civic_registry_relationships_from_record_fk
    FOREIGN KEY (registry_id, from_record_id)
    REFERENCES civic_registry_records(registry_id, id)
    ON DELETE CASCADE,
  CONSTRAINT civic_registry_relationships_to_record_fk
    FOREIGN KEY (registry_id, to_record_id)
    REFERENCES civic_registry_records(registry_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS civic_registry_relationships_type_idx
  ON civic_registry_relationships (registry_id, relationship_type_id);

CREATE INDEX IF NOT EXISTS civic_registry_relationships_from_idx
  ON civic_registry_relationships (registry_id, from_record_id);

CREATE INDEX IF NOT EXISTS civic_registry_relationships_to_idx
  ON civic_registry_relationships (registry_id, to_record_id);
