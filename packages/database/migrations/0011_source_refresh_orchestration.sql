CREATE TABLE IF NOT EXISTS civic_registry_source_refresh_jobs (
  registry_id TEXT NOT NULL,
  id TEXT NOT NULL,
  label TEXT NOT NULL,
  adapter_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  interval_seconds INTEGER NOT NULL CHECK (
    interval_seconds > 0
  ),
  stale_after_seconds INTEGER NOT NULL CHECK (
    stale_after_seconds > 0
  ),
  failure_backoff_base_seconds INTEGER NOT NULL CHECK (
    failure_backoff_base_seconds > 0
  ),
  failure_backoff_max_seconds INTEGER NOT NULL CHECK (
    failure_backoff_max_seconds >=
      failure_backoff_base_seconds
  ),
  adapter_options JSONB NOT NULL DEFAULT '{}'::jsonb,
  next_run_at TIMESTAMPTZ NOT NULL,
  lease_token TEXT,
  lease_expires_at TIMESTAMPTZ,
  last_started_at TIMESTAMPTZ,
  last_completed_at TIMESTAMPTZ,
  last_status TEXT CHECK (
    last_status IS NULL
    OR last_status IN (
      'completed',
      'completed_with_warnings',
      'failed'
    )
  ),
  last_row_count INTEGER CHECK (
    last_row_count IS NULL
    OR last_row_count >= 0
  ),
  last_warning_count INTEGER CHECK (
    last_warning_count IS NULL
    OR last_warning_count >= 0
  ),
  last_output_sha256 TEXT CHECK (
    last_output_sha256 IS NULL
    OR last_output_sha256 ~ '^[0-9a-f]{64}$'
  ),
  last_ingestion_run_id TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (
    consecutive_failures >= 0
  ),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (registry_id, id),
  CONSTRAINT civic_registry_source_refresh_jobs_registry_fk
    FOREIGN KEY (registry_id)
    REFERENCES civic_registry_configurations(registry_id)
    ON DELETE CASCADE,
  CONSTRAINT civic_registry_source_refresh_jobs_last_ingestion_fk
    FOREIGN KEY (
      registry_id,
      last_ingestion_run_id
    )
    REFERENCES civic_registry_ingestion_runs(
      registry_id,
      id
    )
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS
  civic_registry_source_refresh_jobs_due_idx
  ON civic_registry_source_refresh_jobs (
    enabled,
    next_run_at,
    registry_id,
    id
  );

CREATE INDEX IF NOT EXISTS
  civic_registry_source_refresh_jobs_lease_idx
  ON civic_registry_source_refresh_jobs (
    lease_expires_at
  )
  WHERE lease_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS civic_registry_source_refresh_runs (
  registry_id TEXT NOT NULL,
  id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  adapter_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'running',
      'completed',
      'completed_with_warnings',
      'failed'
    )
  ),
  lease_token TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  row_count INTEGER CHECK (
    row_count IS NULL
    OR row_count >= 0
  ),
  previous_row_count INTEGER CHECK (
    previous_row_count IS NULL
    OR previous_row_count >= 0
  ),
  row_count_delta INTEGER,
  warning_count INTEGER CHECK (
    warning_count IS NULL
    OR warning_count >= 0
  ),
  output_sha256 TEXT CHECK (
    output_sha256 IS NULL
    OR output_sha256 ~ '^[0-9a-f]{64}$'
  ),
  source_pages JSONB NOT NULL DEFAULT '[]'::jsonb,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  ingestion_run_id TEXT,
  ingestion_status TEXT,
  ingestion_failed_items INTEGER CHECK (
    ingestion_failed_items IS NULL
    OR ingestion_failed_items >= 0
  ),
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (registry_id, id),
  CONSTRAINT civic_registry_source_refresh_runs_job_fk
    FOREIGN KEY (registry_id, job_id)
    REFERENCES civic_registry_source_refresh_jobs(
      registry_id,
      id
    )
    ON DELETE CASCADE,
  CONSTRAINT civic_registry_source_refresh_runs_ingestion_fk
    FOREIGN KEY (registry_id, ingestion_run_id)
    REFERENCES civic_registry_ingestion_runs(
      registry_id,
      id
    )
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS
  civic_registry_source_refresh_runs_job_started_idx
  ON civic_registry_source_refresh_runs (
    registry_id,
    job_id,
    started_at DESC,
    id DESC
  );

CREATE INDEX IF NOT EXISTS
  civic_registry_source_refresh_runs_status_idx
  ON civic_registry_source_refresh_runs (
    registry_id,
    status,
    started_at DESC
  );
