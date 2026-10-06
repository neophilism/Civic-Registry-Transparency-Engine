CREATE TABLE IF NOT EXISTS civic_registry_sources (
  registry_id TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (
    source_type IN ('webpage', 'document', 'dataset', 'api', 'feed', 'other')
  ),
  visibility TEXT NOT NULL CHECK (
    visibility IN ('public', 'restricted', 'private', 'embargoed')
  ),
  publisher_actor_id TEXT,
  canonical_url TEXT,
  published_at TIMESTAMPTZ,
  retrieved_at TIMESTAMPTZ,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (registry_id, id),
  CONSTRAINT civic_registry_sources_registry_fk
    FOREIGN KEY (registry_id)
    REFERENCES civic_registry_configurations(registry_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS civic_registry_sources_type_idx
  ON civic_registry_sources (registry_id, source_type);

CREATE INDEX IF NOT EXISTS civic_registry_sources_visibility_idx
  ON civic_registry_sources (registry_id, visibility);

CREATE TABLE IF NOT EXISTS civic_registry_documents (
  registry_id TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (
    visibility IN ('public', 'restricted', 'private', 'embargoed')
  ),
  source_id TEXT,
  file_name TEXT,
  mime_type TEXT,
  storage_key TEXT,
  canonical_url TEXT,
  sha256 TEXT,
  page_count INTEGER CHECK (page_count IS NULL OR page_count > 0),
  language TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (registry_id, id),
  CONSTRAINT civic_registry_documents_registry_fk
    FOREIGN KEY (registry_id)
    REFERENCES civic_registry_configurations(registry_id)
    ON DELETE CASCADE,
  CONSTRAINT civic_registry_documents_source_fk
    FOREIGN KEY (registry_id, source_id)
    REFERENCES civic_registry_sources(registry_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT civic_registry_documents_sha256_check
    CHECK (
      sha256 IS NULL OR sha256 ~ '^[A-Fa-f0-9]{64}$'
    )
);

CREATE INDEX IF NOT EXISTS civic_registry_documents_source_idx
  ON civic_registry_documents (registry_id, source_id);

CREATE INDEX IF NOT EXISTS civic_registry_documents_visibility_idx
  ON civic_registry_documents (registry_id, visibility);

CREATE INDEX IF NOT EXISTS civic_registry_documents_sha256_idx
  ON civic_registry_documents (registry_id, sha256)
  WHERE sha256 IS NOT NULL;

CREATE TABLE IF NOT EXISTS civic_registry_citations (
  registry_id TEXT NOT NULL,
  id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  field_id TEXT,
  source_id TEXT,
  document_id TEXT,
  locator JSONB NOT NULL DEFAULT '{}'::jsonb,
  note TEXT,
  visibility TEXT NOT NULL CHECK (
    visibility IN ('public', 'restricted', 'private', 'embargoed')
  ),
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (registry_id, id),
  CONSTRAINT civic_registry_citations_registry_fk
    FOREIGN KEY (registry_id)
    REFERENCES civic_registry_configurations(registry_id)
    ON DELETE CASCADE,
  CONSTRAINT civic_registry_citations_record_fk
    FOREIGN KEY (registry_id, record_id)
    REFERENCES civic_registry_records(registry_id, id)
    ON DELETE CASCADE,
  CONSTRAINT civic_registry_citations_source_fk
    FOREIGN KEY (registry_id, source_id)
    REFERENCES civic_registry_sources(registry_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT civic_registry_citations_document_fk
    FOREIGN KEY (registry_id, document_id)
    REFERENCES civic_registry_documents(registry_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT civic_registry_citations_target_check
    CHECK (source_id IS NOT NULL OR document_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS civic_registry_citations_record_idx
  ON civic_registry_citations (registry_id, record_id);

CREATE INDEX IF NOT EXISTS civic_registry_citations_field_idx
  ON civic_registry_citations (registry_id, record_id, field_id);

CREATE INDEX IF NOT EXISTS civic_registry_citations_source_idx
  ON civic_registry_citations (registry_id, source_id);

CREATE INDEX IF NOT EXISTS civic_registry_citations_document_idx
  ON civic_registry_citations (registry_id, document_id);

CREATE INDEX IF NOT EXISTS civic_registry_citations_visibility_idx
  ON civic_registry_citations (registry_id, visibility);
