# Declarative registry configuration

PR 3 adds `@civic-registry/config`, which turns the generic domain model into a
configuration-driven platform.

## Goal

A downstream application should be able to define the overwhelming majority of
its data model through YAML or JSON:

```text
configuration
     ↓
parse
     ↓
structural validation
     ↓
generic domain validation
     ↓
presentation-reference validation
     ↓
compiled runtime configuration
```

Application code should be reserved for genuinely specialized behavior.

## Schema versioning

Every configuration file begins with:

```yaml
schemaVersion: 1
```

The version is explicit so future changes to the configuration format can be
migrated rather than silently interpreted differently.

## Registry configuration

The `registry` object is the same generic domain definition introduced in
PR 2. It defines record types, fields, relationship types, and generic registry
metadata.

The configuration engine does not introduce bill-specific record types.

## Presentation configuration

Applications may optionally specify list/detail field order and default sorting
per record type.

If omitted:

- list views default to the title field plus the summary field when present;
- detail views default to all configured fields in schema order;
- no default sort is imposed.

Presentation configuration is validated against the record type. A configuration
cannot reference a missing field or choose a default sort field that was not
declared sortable.

## Form metadata

The compiler derives generic form-control metadata from the field type:

| Field type | Generic control |
| --- | --- |
| text | text |
| longText | textarea |
| integer / decimal | number |
| boolean | checkbox |
| date | date |
| datetime | datetime |
| url | url |
| email | email |
| enum | select |
| multiEnum | multi-select |
| entityRef | entity select |
| entityRefList | entity multi-select |
| json | JSON editor |

A later admin-interface milestone can therefore render forms from configuration
rather than shipping custom forms per bill.

## YAML and JSON

Both formats are supported. Auto-detection treats sources beginning with `{`
or `[` as JSON and all other input as YAML.

The engine reports parsing and validation errors through structured issue
objects containing a path, machine-readable code, and human-readable message.

## Downstream pattern

A thin application should eventually resemble:

```text
my-registry-app/
  registry.yaml
  ingestion/
  branding/
  presentation-overrides/
  specialized-code/
```

Most registries should not need to modify the upstream engine.
