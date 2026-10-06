# Source documents, citations, and evidence traceability

PR 8 turns the source/document/citation primitives into a durable evidence
subsystem.

## Traceability model

```text
Registry record
  └── Citation
        ├── optional configured field
        ├── optional source
        ├── optional document
        └── precise locator
```

A citation may support an entire record or one configured field.

For example:

```text
record: legal-interpretation-123
field: legal_authority
citation:
  document: opinion.pdf
  page: 17
  section: III.B
```

The engine remains domain-neutral: the same structure can support legal
interpretations, surveillance registries, federal programs, algorithms, or
other public records.

## Sources

A source represents an authoritative origin such as:

- webpage;
- published document;
- dataset;
- API;
- feed;
- other source.

Sources may carry canonical URLs, publication/retrieval times, descriptions,
and visibility.

## Documents

A document is a concrete artifact and may carry:

- source linkage;
- filename;
- MIME type;
- internal storage key;
- canonical public URL;
- SHA-256 digest;
- page count;
- language.

The public presentation layer intentionally does **not** expose internal
`storageKey` values.

Actual file-byte storage and ingestion remain a separate provider concern. PR 8
establishes the durable metadata and evidence contract that storage adapters
will use.

## Citations

Citations require at least one source or document target.

A locator may contain:

- page / page range;
- section;
- paragraph;
- line / line range;
- fragment label.

When a document page count is known, citation page ranges cannot exceed it.

## Field-level evidence

`Citation.fieldId` is optional.

If present, it must reference a field configured on the cited record's record
type. This enables claim-level evidence without placing application-specific
field names in the engine.

The public UI groups citations by:

- whole record;
- configured field label.

## Visibility boundary

Sources, documents, and citations each carry generic visibility.

Repository rules prevent:

- a public document from exposing a non-public source;
- a public citation from exposing a non-public source or document.

Public evidence queries additionally require the citation and any joined
source/document to be public.

This is defense in depth rather than relying only on the web layer.

## Database schema

Migration `0003_evidence_traceability.sql` adds:

- `civic_registry_sources`;
- `civic_registry_documents`;
- `civic_registry_citations`.

All objects are registry-scoped with composite foreign keys.

Deleting a record cascades its citations. Deleting a source or document that is
still cited is restricted to prevent silent destruction of provenance.

## Repositories

PR 8 adds:

- `SourceRepository`;
- `DocumentRepository`;
- `CitationRepository`.

The PostgreSQL citation repository can return a resolved evidence bundle that
includes the cited document and its provenance source in one query.

Document-only citations automatically resolve the document's configured source.

## Public interface

Record pages show a compact Evidence section when public citations exist.

The complete evidence view is:

```text
/registries/:registryId/records/:recordId/evidence
```

It displays:

- citation scope;
- source;
- document;
- canonical external links;
- locator;
- notes;
- document format/page count/language;
- SHA-256 when available.

## Public API

```text
GET /api/registries/:registryId/records/:recordId/evidence
```

The API returns only public-safe presentation objects. Internal storage keys are
not serialized.

## Seed support

The generic seed format now supports:

```text
sources
documents
records
citations
relationships
```

Seeding is idempotent for evidence IDs just as it is for records.

## Deliberately deferred

PR 8 does not yet provide:

- file upload;
- object-storage adapters;
- OCR or text extraction;
- automated document ingestion;
- citation extraction from documents.

Those capabilities can be added later without changing the public evidence
model introduced here.
