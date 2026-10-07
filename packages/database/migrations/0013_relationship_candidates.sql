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
  evidence_sha256 TEXT NOT NULL CHECK (
    evidence_sha256 ~ '^[0-9a-f]{64}$'
  ),
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

CREATE OR REPLACE FUNCTION
  civic_registry_guard_relationship_candidate_proposal()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM civic_registry_configurations
      WHERE registry_id = OLD.registry_id
    ) THEN
      RETURN OLD;
    END IF;

    RAISE EXCEPTION
      'Relationship candidate review history is immutable; direct DELETE is not permitted.'
      USING ERRCODE = '55000';
  END IF;

  IF
    OLD.registry_id IS DISTINCT FROM NEW.registry_id
    OR OLD.id IS DISTINCT FROM NEW.id
    OR OLD.relationship_type_id IS DISTINCT FROM NEW.relationship_type_id
    OR OLD.from_record_id IS DISTINCT FROM NEW.from_record_id
    OR OLD.to_record_id IS DISTINCT FROM NEW.to_record_id
    OR OLD.extractor IS DISTINCT FROM NEW.extractor
    OR OLD.extractor_version IS DISTINCT FROM NEW.extractor_version
    OR OLD.confidence IS DISTINCT FROM NEW.confidence
    OR OLD.evidence IS DISTINCT FROM NEW.evidence
    OR OLD.evidence_sha256 IS DISTINCT FROM NEW.evidence_sha256
    OR OLD.metadata IS DISTINCT FROM NEW.metadata
    OR OLD.proposed_at IS DISTINCT FROM NEW.proposed_at
    OR OLD.proposed_by IS DISTINCT FROM NEW.proposed_by
  THEN
    RAISE EXCEPTION
      'Relationship candidate proposal evidence is immutable after insertion.'
      USING ERRCODE = '55000';
  END IF;

  IF
    (
      OLD.status IS DISTINCT FROM NEW.status
      OR OLD.reviewed_at IS DISTINCT FROM NEW.reviewed_at
      OR OLD.reviewed_by IS DISTINCT FROM NEW.reviewed_by
      OR OLD.review_note IS DISTINCT FROM NEW.review_note
      OR OLD.relationship_id IS DISTINCT FROM NEW.relationship_id
    )
    AND COALESCE(
      current_setting(
        'civic_registry.relationship_candidate_review',
        true
      ),
      ''
    ) <> 'allowed'
  THEN
    RAISE EXCEPTION
      'Relationship candidate decisions must use the review service.'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS
  civic_registry_relationship_candidates_proposal_immutable
  ON civic_registry_relationship_candidates;

CREATE TRIGGER
  civic_registry_relationship_candidates_proposal_immutable
BEFORE UPDATE OR DELETE
ON civic_registry_relationship_candidates
FOR EACH ROW
EXECUTE FUNCTION
  civic_registry_guard_relationship_candidate_proposal();
