# Disclosure and redaction controls

PR 11 adds non-destructive disclosure controls to the Civic Registry &
Transparency Engine.

The canonical record remains intact for authorized internal use. Public
surfaces receive a separately derived projection that can withhold an entire
record, replace individual fields, and constrain evidence documents.

## Core rule

> Public disclosure is a projection, not destructive editing of the source
> record.

The engine stores the original value and the disclosure instruction
separately.

This matters for:

- auditability;
- later reconsideration of a withholding decision;
- authorized internal workflows;
- immutable history;
- consistent public behavior across UI and API surfaces.

## Registry configuration

A registry may configure:

```yaml
disclosure:
  withheldRecordBehavior: placeholder
  defaultRedactionText: "[REDACTED]"
  defaultWithheldFieldText: "[WITHHELD]"
  withheldRecordTitle: "Record withheld"
  withheldRecordSummary: "Public contents are withheld."
  withheldDocumentTitle: "Document withheld"
  showReasons: true
  showAuthorities: true
```

`withheldRecordBehavior` may be:

- `placeholder`: preserve the public existence of the record while replacing
  its public contents with configured placeholder text;
- `hidden`: remove the record entirely from public lookup, listing, search,
  and relationship traversal.

The default is `placeholder`.

## Record-level withholding

`civic_registry_record_disclosures` stores the current whole-record
disclosure state.

A withheld placeholder exposes only generic record metadata plus the configured
placeholder title/summary.

It does not expose:

- canonical record fields;
- tags;
- external identifiers;
- evidence;
- relationship details;
- historical field snapshots.

A registry configured for hidden withholding exposes no public record at all.

## Field-level disclosure

`civic_registry_field_disclosures` supports:

- `redacted`;
- `withheld`.

Both dispositions replace the canonical field value in the public projection.

A rule may also store:

- replacement text;
- reason;
- authority;
- public note;
- actor;
- update time.

If replacement text is omitted, the registry-level default is used.

The canonical field value is never changed merely because the field is
redacted.

## Public search isolation

Migration `0006_disclosure_redaction.sql` adds:

- `public_fields`;
- `public_search_text`;
- `public_search_document`.

The existing `fields`, `search_text`, and `search_document` remain the
internal/canonical search projection.

Public search explicitly requests:

```text
projection = public
```

and uses only the public projection for:

- full-text matching;
- field filters;
- range filters;
- field sorting;
- field facets;
- tag filtering/facets.

This prevents a hidden value from leaking indirectly through a search match or
facet count.

PostgreSQL recalculates `public_fields` and the public search text whenever a
record field/tag/type or disclosure rule changes.

Direct SQL updates therefore do not bypass field redaction.

## Relationship safety

Public relationship views project every node before presentation.

If whole-record behavior is `hidden`, PostgreSQL graph traversal itself also
excludes withheld nodes. A hidden record cannot act as an invisible bridge that
reveals second-hop relationships.

A placeholder-withheld root exposes no relationship graph.

## Immutable history

PR 9 record revisions retain the canonical historical snapshots.

PR 11 applies the **current disclosure policy** to every historical snapshot
before public presentation.

Therefore a field that is currently redacted cannot be recovered from an older
public revision or before/after diff.

Whole-record withholding suppresses public revision snapshots and limits the
public timeline to disclosure-state events.

## Evidence and documents

Field-scoped citations for a currently redacted/withheld field are suppressed
from the public evidence view.

Whole-record withholding suppresses public evidence entirely.

Document disclosure is stored independently in
`civic_registry_document_disclosures`.

A document may be:

- `disclosed`;
- `redacted`;
- `withheld`.

For a redacted document, the original canonical URL, storage key, and SHA-256
are not returned publicly.

A redacted disclosure may instead specify:

- `publicCanonicalUrl`;
- `publicStorageKey`.

Those values are intended to reference a separately prepared sanitized
artifact.

A withheld document is presented only with the configured generic title and
safe metadata.

## Document redaction metadata

`civic_registry_document_redactions` stores redaction annotations such as:

- page/page range;
- section;
- paragraph;
- line range;
- fragment;
- replacement text;
- reason;
- authority;
- public note.

The public evidence interface can display those annotations.

PR 11 does **not** edit or regenerate PDF/DOCX bytes. It prevents the original
artifact reference from being published and provides metadata plus a safe
replacement-artifact reference.

Actual binary redaction/rendering belongs in an ingestion/document-processing
pipeline, not the registry domain model.

## Reasons and authorities

Disclosure records can carry free-form reason and authority text because the
engine must support many statutory regimes.

Registries may independently choose whether public presentation includes:

- reasons;
- authorities.

Public notes remain available for deliberately public explanatory text.

## Audit events

Database triggers create immutable audit events for disclosure changes,
including:

- `disclosure.record_changed`;
- `disclosure.record_cleared`;
- `disclosure.field_changed`;
- `disclosure.field_cleared`;
- `disclosure.document_changed`;
- `disclosure.document_cleared`;
- `disclosure.document_redaction_added`;
- `disclosure.document_redaction_changed`;
- `disclosure.document_redaction_removed`.

Record-level events integrate with the existing PR 9 public history presenter.

## Typed repository

`PostgresDisclosureRepository` provides typed operations for:

- record disclosure;
- field disclosure;
- document disclosure;
- document redactions;
- bulk record disclosure reads;
- bulk document disclosure reads.

Administrative UI and import workflows should use this repository rather than
writing disclosure SQL directly.

## Deliberately deferred

PR 11 does not add:

- a full administrative redaction editor;
- PDF/image pixel redaction;
- document conversion;
- OCR;
- automatic statutory exemption classification;
- role assignment.

Those belong to later admin, ingestion, and policy-specific layers.
