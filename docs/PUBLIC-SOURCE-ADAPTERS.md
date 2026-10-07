# Public source adapters

The engine provides provider-neutral primitives for retrieving public civic
sources safely and converting them into deterministic ingestion rows.

## Boundary

The reusable engine owns:

- hardened HTTP retrieval;
- HTTPS and host-allowlist enforcement;
- DNS checks that reject loopback, private, link-local, and reserved targets;
- redirect revalidation;
- response-size and timeout controls;
- text and binary retrieval;
- lightweight HTML extraction helpers;
- deterministic row serialization;
- canonical-URL deduplication; and
- SHA-256 run manifests.

A downstream application owns:

- the provider-specific adapter;
- source URLs and allowlisted hosts;
- parsing rules;
- provider identifiers and semantics;
- row mapping into its registry schema;
- refresh cadence and failure policy; and
- provider-specific fixtures/tests.

The core repository intentionally ships no agency- or provider-specific source
adapter.

## Generic adapter contract

An adapter supplies an id, label, allowed hosts, optional default start URLs,
and a `collect` method. The collection returns normalized rows, visited source
pages, and structured warnings.

Rows use the common adapter envelope:

- `id`;
- `external_id`;
- `title`;
- `canonical_url`;
- `source_adapter`;
- `retrieved_at`; and
- optional application fields such as attachment URLs.

Those rows then enter the ordinary configured ingestion pipeline. The adapter
layer does not bypass schema validation, lifecycle rules, or audit behavior.

## Testing

Engine tests use only synthetic `example.gov` adapters and fixtures. CI does
not contact live government websites.

Downstream applications should test their provider-specific parsers in their
own repositories while continuing to rely on the engine tests for retrieval,
serialization, and ingestion boundaries.
