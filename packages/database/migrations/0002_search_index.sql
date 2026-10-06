ALTER TABLE civic_registry_records
  ADD COLUMN IF NOT EXISTS search_text TEXT NOT NULL DEFAULT '';

ALTER TABLE civic_registry_records
  ADD COLUMN IF NOT EXISTS search_document TSVECTOR
  GENERATED ALWAYS AS (
    to_tsvector('simple', COALESCE(search_text, ''))
  ) STORED;

CREATE INDEX IF NOT EXISTS civic_registry_records_search_document_idx
  ON civic_registry_records USING GIN (search_document);
