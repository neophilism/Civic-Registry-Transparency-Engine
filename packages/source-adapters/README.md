# Public source adapters

Safe, provider-neutral HTTP retrieval and deterministic normalization primitives for civic source adapters.

This package is intentionally small. It owns transport and deterministic adapter-run behavior, not source-specific civic policy.

Key guarantees:

- HTTPS only;
- adapter-defined host allowlists;
- private/reserved network rejection after DNS resolution;
- redirect revalidation;
- response byte limits and timeouts;
- deterministic NDJSON output;
- canonical-URL deduplication; and
- SHA-256 run manifests.

Source-specific adapters live with their thin applications. See `examples/open-legal-interpretations/adapters` and `docs/PUBLIC-SOURCE-ADAPTERS.md`.
