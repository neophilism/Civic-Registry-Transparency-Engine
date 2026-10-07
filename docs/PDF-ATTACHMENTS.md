# PDF attachment ingestion and extraction

The engine provides generic document-ingestion primitives for public PDF
attachments.

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

The storage interface is replaceable so deployments can add object storage or
other durable backends without changing evidence records.

## Safe binary retrieval

Binary fetching uses the same protections as text source retrieval:

- HTTPS for non-local sources;
- per-adapter host allowlists;
- rejection of loopback/private/link-local/reserved destinations;
- redirect revalidation;
- request timeout;
- response-size caps; and
- deterministic provenance metadata.

A remote content-type header is advisory. PDF processing still requires a real
PDF signature.

## Content-addressed storage

The filesystem implementation stores documents under:

```text
sha256/<first-two-hash-characters>/<full-sha256>.pdf
```

Repeated identical bytes are idempotent. Changed bytes at the same source URL
create a new immutable document version while preserving earlier evidence.

Configure the local storage root with:

```bash
CIVIC_REGISTRY_DOCUMENT_STORAGE_DIR=/persistent/path
```

Production deployments using filesystem storage must mount durable storage.

## Evidence model

For each retrieved attachment, the generic attachment service can materialize:

- a `Source` representing the public URL;
- a versioned `Document` representing exact retrieved bytes;
- a PDF extraction record; and
- a `Citation` linking the document to a configured registry record/field.

Application-specific decisions about which URLs to fetch and which canonical
field, if any, should be enriched from extracted text remain downstream.

## OCR boundary

The built-in extractor handles textual PDFs. Scanned documents with no
extractable text retain explicit warnings. OCR is intentionally a separate
capability so its extractor identity and provenance can be recorded.

## Tests

Engine tests use generated PDFs and synthetic public URLs. They verify:

- extraction;
- content-addressed storage;
- safe binary retrieval;
- evidence materialization;
- idempotency;
- changed-content version preservation; and
- cryptographic integrity after evidence changes.
