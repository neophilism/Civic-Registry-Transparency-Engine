# @civic-registry/source-adapters

Provider-neutral primitives for safely retrieving public web sources and
producing deterministic normalized rows for the Civic Registry ingestion
pipeline.

The package provides:

- hardened HTTP retrieval with host allowlists and SSRF protections;
- text and binary fetch support;
- lightweight HTML extraction helpers;
- the generic `SourceAdapter` contract;
- deterministic NDJSON serialization;
- canonical-URL deduplication; and
- SHA-256 run manifests.

Provider-specific adapters do **not** belong in this package or repository.
They live with the downstream application that understands the provider's
markup, identifiers, semantics, cadence, and failure behavior.

See [Public source adapters](../../docs/PUBLIC-SOURCE-ADAPTERS.md).
