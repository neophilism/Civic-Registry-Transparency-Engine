# Generic domain model

PR 2 introduces the first reusable engine package: `@civic-registry/core`.

## Registry definition

A registry is a configured collection of one or more record types.

```text
RegistryDefinition
  ├── RecordTypeDefinition[]
  │     └── FieldDefinition[]
  └── RelationshipTypeDefinition[]
```

The engine does not assign statutory or policy meaning to record types. That
meaning belongs to downstream applications.

## Record types

Each record type has:

- a stable machine identifier;
- singular and plural human names;
- a title field;
- optional summary field;
- typed fields.

Supported field types currently include:

- text and long text;
- integers and decimals;
- booleans;
- dates and date-times;
- URLs and email addresses;
- single and multiple enumerations;
- references to other record types;
- generic JSON.

Additional field behavior should be added only when it is broadly reusable.

## Records

A registry record identifies its registry and record type, stores configured
field values, and carries generic operational metadata:

- status;
- visibility;
- external identifiers;
- tags;
- creation/update/publication times.

Status remains an application-defined string because different registries have
different lifecycle vocabularies. A later publication-workflow milestone will
provide configurable lifecycle rules.

## Sources and evidence

The core distinguishes:

- **Source** — an authoritative origin such as a webpage, API, dataset, or
  published document;
- **Document** — a concrete file or document artifact;
- **Citation** — a record-to-source/document reference with an optional precise
  locator.

This preserves the architecture requirement that public facts can be traced to
their underlying evidence.

## Relationships

Relationship types are configured separately from relationship instances.
Applications can therefore define relationships such as "supersedes",
"administered by", "authorized by", or "related to" without adding those terms
to the engine core.

## Versions

`RecordVersion` captures a complete record snapshot plus version number,
timestamp, actor, and reason. PR 2 defines the domain primitive; the immutable
history implementation arrives in the dedicated audit/version milestone.

## Validation invariants

Registry-definition validation currently enforces:

- valid stable machine identifiers;
- at least one record type;
- unique record type and field identifiers;
- valid title/summary field references;
- enum option requirements;
- valid entity-reference targets;
- valid relationship record-type references.

Record validation enforces:

- registry and record-type membership;
- supported visibility;
- timestamps;
- required fields;
- no undeclared fields;
- field values matching configured field types and enum values.

Persistence must never become the first place malformed domain data is
detected.
