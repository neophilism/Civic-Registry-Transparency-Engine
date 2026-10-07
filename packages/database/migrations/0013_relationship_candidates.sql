CREATE TABLE IF NOT EXISTS civic_registry_relationship_candidates (
  registry_id TEXT NOT NULL,
  id TEXT NOT NULL,
  relationship_type_id TEXT NOT NULL,
  from_record_id TEXT NOT NULL,
  to_record_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN (
      'pending',
      'approved',
      'rejected'
    )
  ),
  extractor TEXT NOT NULL,
  extractor_version TEXT NOT NULL,
  confidence NUMERIC(5,4) NOT NULL CHECK (
    confidence >= 0
    AND confidence <= 1
  ),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  proposed_at TIMESTAMPTZ NOT NULL,
  proposed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  review_note TEXT,
  relationship_id TEXT,
  PRIMARY KEY (registry_id, id),
  CONSTRAINT civic_registry_relationship_candidates_registry_fk
    FOREIGN KEY (registry_id)
    REFERENCES civic_registry_configurations(registry_id)
    ON DELETE CASCADE,
  CONSTRAINT civic_registry_relationship_candidates_from_fk
    FOREIGN KEY (registry_id, from_record_id)
    REFERENCES civic_registry_records(registry_id, id)
    ON DELETE CASCADE,
  CONSTRAINT civic_registry_relationship_candidates_to_fk
    FOREIGN KEY (registry_id, to_record_id)
    REFERENCES civic_registry_records(registry_id, id)
    ON DELETE CASCADE,
  CONSTRAINT civic_registry_relationship_candidates_review_check
    CHECK (
      (
        status = 'pending'
        AND reviewed_at IS NULL
        AND reviewed_by IS NULL
        AND relationship_id IS NULL
      )
      OR (
        status = 'approved'
        AND reviewed_at IS NOT NULL
        AND reviewed_by IS NOT NULL
        AND relationship_id IS NOT NULL
      )
      OR (
        status = 'rejected'
        AND reviewed_at IS NOT NULL
        AND reviewed_by IS NOT NULL
        AND relationship_id IS NULL
      )
    )
);

CREATE INDEX IF NOT EXISTS
  civic_registry_relationship_candidates_pending_idx
  ON civic_registry_relationship_candidates (
    registry_id,
    status,
    proposed_at DESC,
    id
  );

CREATE INDEX IF NOT EXISTS
  civic_registry_relationship_candidates_from_idx
  ON civic_registry_relationship_candidates (
    registry_id,
    from_record_id,
    status,
    proposed_at DESC
  );

CREATE INDEX IF NOT EXISTS
  civic_registry_relationship_candidates_to_idx
  ON civic_registry_relationship_candidates (
    registry_id,
    to_record_id,
    status,
    proposed_at DESC
  );
