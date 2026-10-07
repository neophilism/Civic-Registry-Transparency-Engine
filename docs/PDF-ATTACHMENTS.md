# PDF attachment ingestion and extraction

PR 22 adds generic document-ingestion primitives for official PDF attachments and wires them into the Open Legal Interpretations refresh pipeline.

The architecture is:

```text
source adapter row
  -> attachment URL allowlist
  -> hardened binary fetch
  -> SHA-256 content hash
  -> PDF signature validation
  -> content-addressed storage
  -> PDF text extraction
  -> Source + Document + Citation evidence records
  -> optional full-text enrichment of the canonical record
  -> ordinary history/search/integrity behavior
```

## Generic document package

`@civic-registry/documents` provides:

- a generic `DocumentStorage` interface;
- content-addressed filesystem storage;
- deterministic SHA-256 storage keys;
- PDF signature validation;
- PDF text extraction with `pdfjs-dist`;
- page-by-page extracted text;
- extractor/version metadata;
- extracted-text SHA-256; and
- extraction warnings.

The storage interface is deliberately generic so later deployments can add object-storage implementations without changing the attachment-ingestion service.

## Safe binary retrieval

PR 22 extends the existing hardened public-source client with `fetchBytes`.

Binary fetches preserve the same protections used by HTML source adapters:

- HTTPS only;
- per-adapter host allowlists;
- DNS rejection of loopback/private/link-local/reserved destinations;
- redirect revalidation;
- request timeout;
- response-size cap; and
- deterministic final URL/provenance metadata.

The attachment service defaults to a 25 MiB response limit and a 30-second timeout.

A remote `Content-Type` header is treated as advisory. PDF processing still requires a real `%PDF-` file signature.

## Content-addressed storage

The filesystem implementation stores documents under:

```text
sha256/<first-two-hash-characters>/<full-sha256>.pdf
```

Writing the same content repeatedly is idempotent.

For local development the default directory is:

```text
./data/documents
```

Configure it with:

```bash
CIVIC_REGISTRY_DOCUMENT_STORAGE_DIR=/persistent/path
```

### Deployment requirement

The filesystem directory must live on persistent storage.

Do **not** point production ingestion at an ephemeral container filesystem unless loss of the stored document bytes is acceptable. On platforms such as Render, mount a persistent disk/volume or implement another `DocumentStorage` backend.

Database evidence rows store the content hash and storage key, so the backing bytes can remain outside PostgreSQL.

## Evidence model

For each retrieved attachment, the generic attachment service materializes:

- a `Source` representing the official attachment URL;
- a versioned `Document` representing the exact retrieved bytes;
- a PDF extraction row; and
- a `Citation` linking the document to the canonical registry record/field.

The document id includes both the stable source URL identity and the content SHA-256.

Therefore:

- fetching the same URL with identical bytes reuses the existing document/citation;
- fetching the same URL after the official bytes change creates a new immutable document version;
- prior versions remain available as evidence rather than being silently overwritten.

## Extraction persistence

Migration `0012_document_extractions.sql` adds:

`civic_registry_document_extractions`

Each extraction stores:

- document id;
- extractor name;
- extractor version;
- full extracted text;
- extracted-text SHA-256;
- page-level text;
- warnings; and
- extraction timestamp.

The extraction is separate from the document metadata so a future extractor/OCR implementation can coexist with the same immutable source document.

## PDF extraction

The current extractor is `pdfjs-dist`.

Security-oriented settings disable JavaScript evaluation and font rendering requirements used only for display.

For each page the extractor collects textual content in reading order as exposed by PDF.js.

If a page contains no extractable text, the extraction records a warning.

If the entire document contains no extractable text, the result is retained with an explicit warning that OCR may be required.

PR 22 does **not** silently OCR scanned documents. OCR should be a separate follow-on capability with its own provenance/extractor metadata.

## Open Legal Interpretations integration

The DOJ OLC and OGE adapters already emit `attachment_urls` when official PDF/download links are available.

After the normal adapter row is ingested, the scheduled refresh worker now:

1. processes each attachment URL through the generic PDF service;
2. uses the adapter's same official-host allowlist;
3. persists source/document/citation/extraction evidence;
4. aggregates attachment warnings into the source-refresh run; and
5. updates the configured `full_text` field when extracted text is available.

Full-text updates use the ordinary record repository with:

- actor: `system:source-refresh-worker`;
- reason: `Refresh full text from retrieved PDF attachment.`

That means the enrichment automatically participates in:

- immutable record history;
- search-index maintenance;
- notifications where configured;
- deadline reconciliation where applicable; and
- PR 18 cryptographic audit integrity.

## Failure behavior

Attachment processing is intentionally isolated per URL.

One broken or malformed attachment does not discard a successful source-adapter/record ingestion.

Instead the refresh accumulates structured warnings such as:

- `pdf_attachment_failed`
- `pdf_attachment_warning`

This causes the source refresh to surface a warning state while preserving successfully ingested metadata and documents.

## Idempotency and changed source files

The attachment integration test proves three cases.

### First retrieval

A new PDF creates:

- source;
- document;
- extraction;
- citation; and
- extracted full text.

### Repeated retrieval, unchanged bytes

A second fetch of the same URL/bytes:

- does not create a duplicate document;
- does not create a duplicate citation; and
- does not create a redundant full-text record revision.

### Same official URL, changed bytes

If the remote file later changes:

- SHA-256 changes;
- a new document id/version is created;
- the old document remains;
- a second citation preserves the new evidence version; and
- the canonical record can be enriched with the new extracted text.

## Current storage boundary

PR 22 ships a filesystem `DocumentStorage` implementation because it is deterministic, testable, and works with mounted persistent volumes.

The interface is intentionally not filesystem-specific.

Future implementations can add S3-compatible/object storage, cloud blob storage, or WORM archives without changing:

- attachment retrieval;
- PDF extraction;
- database evidence records; or
- thin-application processing.

## Tests

PR 22 adds offline tests only. CI does not download real government PDFs.

Unit tests verify:

- text extraction from a generated PDF fixture;
- deterministic extracted-text hashes;
- page extraction;
- content-addressed storage idempotency;
- hardened binary source fetching; and
- host-allowlist enforcement.

The PostgreSQL integration test verifies:

- first attachment materialization;
- extraction persistence;
- source/document/citation linkage;
- field-level page locator creation;
- same-content idempotency;
- changed-content version preservation;
- full-text enrichment;
- prevention of redundant full-text revisions; and
- valid cryptographic integrity after enrichment.

## Next milestone

PR 23 can build structured legal-authority extraction on top of the trustworthy PDF/full-text corpus created here.

That work should produce candidate authority relationships with explicit provenance and confidence/review state rather than silently asserting relationships inferred from unstructured text.
