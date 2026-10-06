CREATE TABLE IF NOT EXISTS civic_registry_ingestion_runs (
  registry_id TEXT NOT NULL,
  id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  profile JSONB NOT NULL,
  input_format TEXT NOT NULL CHECK (
    input_format IN ('json', 'ndjson', 'csv')
  ),
  ingestion_mode TEXT NOT NULL CHECK (
    ingestion_mode IN ('create', 'upsert')
  ),
  source_label TEXT NOT NULL,
  source_uri TEXT,
  input_sha256 TEXT NOT NULL CHECK (
    input_sha256 ~ '^[0-9a-f]{64}$'
  ),
  dry_run BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL CHECK (
    status IN (
      'running',
      'completed',
      'completed_with_errors',
      'failed'
    )
  ),
  total_items INTEGER NOT NULL DEFAULT 0 CHECK (
    total_items >= 0
  ),
  created_items INTEGER NOT NULL DEFAULT 0 CHECK (
    created_items >= 0
  ),
  updated_items INTEGER NOT NULL DEFAULT 0 CHECK (
    updated_items >= 0
  ),
  unchanged_items INTEGER NOT NULL DEFAULT 0 CHECK (
    unchanged_items >= 0
  ),
  validated_items INTEGER NOT NULL DEFAULT 0 CHECK (
    validated_items >= 0
  ),
  failed_items INTEGER NOT NULL DEFAULT 0 CHECK (
    failed_items >= 0
  ),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  actor_id TEXT,
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (registry_id, id),
  CONSTRAINT civic_registry_ingestion_runs_registry_fk
    FOREIGN KEY (registry_id)
    REFERENCES civic_registry_configurations(registry_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS
  civic_registry_ingestion_runs_registry_started_idx
  ON civic_registry_ingestion_runs (
    registry_id,
    started_at DESC,
    id
  );

CREATE INDEX IF NOT EXISTS
  civic_registry_ingestion_runs_profile_idx
  ON civic_registry_ingestion_runs (
    registry_id,
    profile_id,
    started_at DESC
  );

CREATE TABLE IF NOT EXISTS civic_registry_ingestion_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  registry_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  item_index INTEGER,
  line_number INTEGER,
  source_key TEXT,
  record_id TEXT,
  input_fingerprint TEXT CHECK (
    input_fingerprint IS NULL
    OR input_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  outcome TEXT NOT NULL CHECK (
    outcome IN (
      'created',
      'updated',
      'unchanged',
      'validated',
      'failed'
    )
  ),
  error_code TEXT,
  error_message TEXT,
  error_details JSONB NOT NULL DEFAULT '[]'::jsonb,
  processed_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT civic_registry_ingestion_items_run_fk
    FOREIGN KEY (registry_id, run_id)
    REFERENCES civic_registry_ingestion_runs(registry_id, id)
    ON DELETE CASCADE,
  CONSTRAINT civic_registry_ingestion_item_failure_check
    CHECK (
      outcome <> 'failed'
      OR error_code IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS
  civic_registry_ingestion_items_run_idx
  ON civic_registry_ingestion_items (
    registry_id,
    run_id,
    id
  );

CREATE INDEX IF NOT EXISTS
  civic_registry_ingestion_items_record_idx
  ON civic_registry_ingestion_items (
    registry_id,
    record_id,
    id DESC
  )
  WHERE record_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS
  civic_registry_ingestion_items_run_item_unique_idx
  ON civic_registry_ingestion_items (
    registry_id,
    run_id,
    item_index
  )
  WHERE item_index IS NOT NULL;
