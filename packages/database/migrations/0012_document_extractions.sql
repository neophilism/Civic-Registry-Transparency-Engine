CREATE TABLE IF NOT EXISTS civic_registry_document_extractions (
  registry_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  extractor TEXT NOT NULL,
  extractor_version TEXT NOT NULL,
  text_content TEXT NOT NULL,
  text_sha256 TEXT NOT NULL CHECK (
    text_sha256 ~ '^[0-9a-f]{64}$'
  ),
  pages JSONB NOT NULL DEFAULT '[]'::jsonb,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  extracted_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (
    registry_id,
    document_id,
    extractor
  ),
  CONSTRAINT civic_registry_document_extractions_document_fk
    FOREIGN KEY (registry_id, document_id)
    REFERENCES civic_registry_documents(
      registry_id,
      id
    )
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS
  civic_registry_document_extractions_text_sha_idx
  ON civic_registry_document_extractions (
    registry_id,
    text_sha256
  );

CREATE INDEX IF NOT EXISTS
  civic_registry_document_extractions_extracted_idx
  ON civic_registry_document_extractions (
    registry_id,
    extracted_at DESC,
    document_id
  );
