# Public source adapters

PR 20 adds a provider-neutral retrieval layer for official public civic sources and the first two Open Legal Interpretations source adapters.

The adapter boundary is intentionally separate from database ingestion:

```text
official website
  -> hardened source fetcher
  -> source-specific discovery/extraction
  -> deterministic NDJSON + signed-by-hash run manifest
  -> existing generic ingestion service
  -> registry/history/search/deadlines/integrity
```

Fetching a website therefore never grants that website direct write access to the registry.

## Generic adapter infrastructure

`@civic-registry/source-adapters` provides:

- HTTPS-only retrieval;
- per-adapter hostname allowlists;
- DNS checks that reject loopback, private, link-local, multicast, and reserved destinations;
- redirect revalidation against the same host policy;
- request timeouts;
- response-size limits;
- text/HTML content-type enforcement;
- dependency-free HTML link/text helpers;
- deterministic NDJSON serialization;
- duplicate suppression by canonical URL; and
- a SHA-256 run manifest.

The manifest records:

- adapter id and label;
- retrieval timestamp;
- row count;
- source pages visited;
- warnings; and
- SHA-256 of the exact NDJSON output.

This is provenance for the extraction run. It is not a claim that the remote source cryptographically signed its content.

## DOJ Office of Legal Counsel adapter

Adapter id:

`doj-olc`

Default catalog:

`https://www.justice.gov/olc/opinions`

The adapter:

1. walks server-rendered catalog pages up to configured limits;
2. discovers individual `/olc/opinion/...` pages;
3. fetches each opinion page through the hardened source client;
4. extracts the public title, date of issuance, headnotes/description, canonical page URL, and PDF/download links when present; and
5. emits an Open Legal Interpretations ingestion row.

It intentionally does not infer a public-release date, declassification date, or legal-authority relationship when the source page does not explicitly provide one.

The configured issuing body is:

`usdoj-office-of-legal-counsel`

## U.S. Office of Government Ethics adapter

Adapter id:

`oge-legal-advisories`

Default discovery pages include OGE's Legal Research Search Collection and Electronic Records Room.

The adapter recognizes OGE Legal Advisory resource URLs containing `LA-YY-NN`, then extracts:

- advisory number;
- title;
- date;
- short description;
- canonical resource URL; and
- advisory PDF link when exposed on the page.

The configured issuing body is:

`us-office-government-ethics`

OGE's Legal Research Collection may render result rows client-side. When the server response does not expose advisory links, the adapter returns an explicit `no_items_discovered` warning rather than fabricating results. Operators can provide one or more `--start-url=` values pointing to official OGE advisory resource pages or server-rendered advisory indexes.

## Fetch commands

DOJ OLC:

```bash
pnpm source:fetch-olc -- data/olc.ndjson --max-items=100 --max-pages=5
```

OGE:

```bash
pnpm source:fetch-oge -- data/oge.ndjson --max-items=100 --max-pages=5
```

A custom start URL can be repeated:

```bash
pnpm source:fetch-oge -- data/oge.ndjson \
  --start-url=https://www.oge.gov/web/oge.nsf/Resources/LA-25-01%3A%2BEffect%2Bof%2BPay%2BAdjustments%2Bon%2BEthics%2BProvisions%2Bfor%2BCalendar%2BYear%2B2025
```

Each command writes:

- the requested NDJSON file; and
- `<output>.manifest.json` by default.

Use `--manifest=other.json` to override the sidecar path.

## Ingesting adapter output

Seed the reference registry first:

```bash
pnpm db:seed-open-legal-interpretations
```

Then ingest an adapter output file:

```bash
pnpm db:ingest-open-legal-interpretations-source -- data/olc.ndjson ndjson
```

The source-specific adapter profile maps normalized rows into the existing `interpretation` schema.

The ordinary ingestion service still owns:

- schema validation;
- idempotent upsert behavior;
- lifecycle bootstrap protections;
- immutable history;
- search indexing;
- deadline reconciliation when applicable; and
- PR 18 cryptographic integrity capture.

## Data minimization and non-inference rules

Adapters should prefer explicit source facts over guesses.

PR 20 deliberately does not infer:

- release dates from issue dates;
- declassification deadlines;
- supersession relationships;
- legal authorities from unstructured prose; or
- full opinion text when only a headnote/summary page is being parsed.

Attachment URLs are preserved in adapter rows for provenance/future document ingestion, but PR 20 does not download or parse PDFs.

## Testing

CI does not call live government websites.

Unit tests use synthetic structural HTML fixtures to verify:

- DOJ catalog discovery;
- DOJ opinion parsing;
- OGE advisory discovery;
- OGE advisory parsing;
- private-address and unsafe-redirect blocking;
- response-size enforcement; and
- deterministic NDJSON serialization.

The PostgreSQL integration test additionally proves that a normalized adapter row:

1. ingests through the existing NDJSON pipeline;
2. resolves to the configured official issuing body;
3. preserves the official source URL;
4. does not manufacture a publication timestamp; and
5. leaves the PR 18 integrity chain valid.

## Operational boundary

Site layouts can change.

A source adapter is considered healthy only when it continues to discover and parse expected records. Production scheduling should monitor:

- zero-record runs;
- warning count;
- row-count deltas;
- manifest hash changes; and
- ingestion failures.

Future work can add scheduled refresh orchestration, attachment/PDF ingestion, structured legal-authority extraction, and source-specific health dashboards without changing the canonical registry model.


## Scheduled refresh orchestration

PR 21 adds database-backed recurring execution, worker leases, retry backoff, row-count/empty-result health checks, and administrator monitoring around these adapters.

See [Scheduled source refresh](SOURCE-REFRESH.md).

The adapter package remains responsible only for safe retrieval and deterministic normalization. Scheduling and operational state are generic engine capabilities, while the DOJ/OGE job definitions remain in the Open Legal Interpretations thin application.
