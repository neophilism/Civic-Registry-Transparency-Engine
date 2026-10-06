# Import and ingestion pipelines

PR 13 adds reusable structured import infrastructure to the Civic Registry &
Transparency Engine.

The ingestion abstraction is:

> decode → map → normalize/coerce → validate → create/upsert → audit/report

The engine does not hard-code agency feeds, bill-specific fields, or scraper
logic. Those belong in downstream source adapters and import profiles.

## Separation of concerns

Registry configuration defines the canonical civic data model.

An **ingestion profile** separately describes how one external file/feed maps
into that configured model.

This distinction is intentional:

- registry policy remains stable and reusable;
- source-specific column names stay outside the core schema;
- multiple feeds can populate the same record type;
- a feed can change without changing the registry's public contract.

## Supported structured formats

The provider-neutral decoder supports:

- JSON arrays of objects;
- newline-delimited JSON (NDJSON / JSONL);
- CSV with quoted fields, escaped quotes, embedded commas, and quoted newlines.

NDJSON and CSV decoding can report row-level failures while continuing with
other rows.

Fatal structural errors, such as an unclosed CSV quote or non-array JSON root,
are reported as ingestion diagnostics.

## Stable fingerprints

Every decoded source row receives a SHA-256 fingerprint based on a stable JSON
serialization.

Object key order does not change the fingerprint.

Each ingestion run also stores a SHA-256 hash of the complete input.

The engine deliberately stores hashes and diagnostics rather than silently
persisting a second raw copy of the imported dataset.

## Import profiles

Profiles may be YAML or JSON.

Example:

```yaml
id: example-document-import
recordTypeId: document
mode: upsert

recordId:
  path: id
  required: true
  trim: true

sourceKey:
  path: external_id
  required: true

fields:
  title:
    path: title
    required: true
    trim: true

  document_type:
    path: type

status:
  literal: published

visibility:
  literal: public

staticTags:
  - imported

externalIdentifiers:
  - scheme: example-source
    value:
      path: external_id

allowLifecycleBootstrap: true
replaceFields: false
```

The generic example is available at
`examples/generic-registry/import-profile.yaml`.

## Source paths

Path mappings support nested object traversal and array indexes.

Examples:

```yaml
path: agency.name
```

```yaml
path: results[0].identifier
```

A path mapping may also specify:

- `required`;
- `trim`;
- `split`.

Literal mappings use:

```yaml
literal: public
```

A value specification must choose exactly one of `path` or `literal`.

## Schema-aware coercion

Mapped field values are coerced according to the target registry field type.

Supported behavior includes:

- scalar-to-string conversion for text/reference/enum-like fields;
- integer and decimal parsing;
- common boolean forms such as true/false, yes/no, and 1/0;
- datetime normalization;
- split/array handling for multi-value fields;
- direct JSON values for JSON fields.

After coercion, the canonical registry validator still runs.

The ingestion layer does not weaken or bypass registry validation.

## Record identity and source identity

Every profile must produce a stable `recordId`.

A profile may separately produce a `sourceKey`.

If `sourceKey` is omitted, the record id becomes the source key.

Within a run:

- duplicate source keys are rejected;
- duplicate record ids are rejected.

The runner does not use last-write-wins behavior for ambiguous duplicate rows.

## Create and upsert modes

`mode: create` rejects a row when the target record already exists.

`mode: upsert` creates missing records and updates existing records.

Repeated identical upserts are detected as `unchanged` and do not create
spurious record revisions.

## Safe partial updates

Upserts are patch-like by default.

For an existing record, fields not owned by the profile are preserved.

The runner also preserves status, visibility, publication metadata, tags, and
external identifiers when the profile does not explicitly manage them.

A full source snapshot can opt into:

```yaml
replaceFields: true
```

With field replacement enabled, unmapped optional fields are removed.

This destructive behavior is explicit rather than the default.

## Lifecycle safety

For a lifecycle-managed registry:

- a profile that does not map status preserves the existing status during
  upsert;
- a profile cannot silently move an existing record between lifecycle states;
- non-initial status creation requires
  `allowLifecycleBootstrap: true`.

Lifecycle bootstrap is intended only for importing authoritative pre-existing
state, such as already-published historical records.

Ordinary status changes still go through the publication lifecycle service.

## Deadlines and other engine behavior

The ingestion runner writes records through `PostgresRecordRepository`.

It therefore receives the same:

- schema validation;
- search indexing;
- immutable revision history;
- public disclosure projection behavior;
- deadline reconciliation

as ordinary application writes.

There is no parallel “import-only” record storage path.

## Row isolation

A mapping or persistence failure for one item does not abort the entire batch.

Each row receives one durable outcome:

- `created`;
- `updated`;
- `unchanged`;
- `validated`;
- `failed`.

Failed rows retain an error code, message, structured details, source-row
index/line when available, source key when resolved, and input fingerprint.

## Dry runs

A dry run executes decoding, mapping, coercion, schema validation, identity
checks, and run/item reporting without mutating registry records.

Successful rows receive the `validated` outcome.

This provides a safe preflight path for new feeds and profile changes.

## Persistent run tracking

Migration `0008_ingestion_pipeline.sql` adds:

- `civic_registry_ingestion_runs`;
- `civic_registry_ingestion_items`.

A run stores:

- exact profile snapshot;
- profile id;
- format and create/upsert mode;
- source label/reference;
- input SHA-256;
- dry-run flag;
- start/completion state;
- outcome counters;
- actor/reason;
- generic metadata.

Run status is one of:

- `running`;
- `completed`;
- `completed_with_errors`;
- `failed`.

## Record audit linkage

Successful non-dry-run rows add a private immutable audit event to the affected
record:

- `ingestion.record_created`;
- `ingestion.record_updated`;
- `ingestion.record_unchanged`.

The event links the record to:

- ingestion run id;
- profile id;
- source key;
- input fingerprint.

This is operational provenance for the import itself.

Primary-source evidentiary provenance remains represented by the existing
`Source`, `Document`, and `Citation` domain objects. Source-specific
adapters can attach those objects without changing the ingestion core.

## CLI

After the target registry configuration is installed:

```bash
pnpm db:ingest \
  public-document-catalog \
  examples/generic-registry/import-profile.yaml \
  examples/generic-registry/import.csv
```

The format is inferred from `.json`, `.ndjson` / `.jsonl`, or `.csv`.

It may also be supplied explicitly:

```bash
pnpm db:ingest <registry-id> <profile> <input> ndjson
```

Dry run:

```bash
pnpm db:ingest <registry-id> <profile> <input> --dry-run
```

or:

```bash
pnpm db:ingest <registry-id> <profile> <input> csv --dry-run
```

## Querying run history

`PostgresIngestionService` exposes:

- `getRun`;
- `listRuns`;
- `listItems`;
- `run`.

This is the foundation for the PR 15 administrative console.

## Deliberately deferred

PR 13 does not add real agency-specific web/API/feed adapters.

Those are intentionally deferred to PR 20 after the first thin application
exercises the engine.

It also does not add:

- browser-based import administration;
- scheduled polling;
- scraping logic;
- PDF/OCR extraction;
- binary document downloading;
- automatic source-specific field inference;
- arbitrary code execution inside mappings.

Those capabilities belong in later admin/document-processing adapters rather
than the domain-neutral ingestion core.
