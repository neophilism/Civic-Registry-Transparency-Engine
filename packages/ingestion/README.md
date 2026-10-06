# @civic-registry/ingestion

Provider-neutral structured ingestion for the Civic Registry & Transparency
Engine.

The package handles:

- JSON, NDJSON, and CSV decoding;
- row-level decode diagnostics;
- stable SHA-256 fingerprints;
- YAML/JSON import profiles;
- nested source-path extraction;
- schema-aware field coercion;
- mapping into canonical `RegistryRecord` objects;
- validation against compiled registry configuration.

It deliberately contains no PostgreSQL code and no agency-specific adapters.

Persistent import runs and create/upsert behavior live in
`@civic-registry/database`.

See [Import and ingestion pipelines](../../docs/INGESTION.md).
