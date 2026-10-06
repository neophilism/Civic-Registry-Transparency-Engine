# @civic-registry/config

Declarative configuration engine for the Civic Registry & Transparency Engine.

Downstream applications can define registries in YAML or JSON instead of
modifying engine code.

## What configuration controls

- registry identity and description;
- record types;
- fields and field behavior;
- entity-reference targets;
- relationship types;
- default record type;
- public-by-default behavior;
- configurable publication lifecycle statuses and transitions;
- role and approval requirements;
- scheduled-publication rules;
- public disclosure and redaction defaults;
- whole-record withholding behavior;
- list/detail field presentation;
- default sort behavior.

The compiler also derives generic form-control metadata from field types so
future admin and public form interfaces do not need handwritten forms for every
registry.

## Example

```yaml
schemaVersion: 1

registry:
  id: sample-registry
  name: Sample Registry

  recordTypes:
    - id: item
      name: Item
      pluralName: Items
      titleFieldId: name

      fields:
        - id: name
          label: Name
          type: text
          required: true
          searchable: true

        - id: published_on
          label: Published on
          type: date
          sortable: true

publicationLifecycle:
  initialStatusId: draft
  statuses:
    - id: draft
      label: Draft
    - id: published
      label: Published
      publiclyVisible: true
      marksPublished: true
  transitions:
    - fromStatusId: draft
      toStatusId: published
      allowedRoles: [publisher]

presentation:
  recordTypes:
    item:
      listFields:
        - name
        - published_on
      defaultSort:
        fieldId: published_on
        direction: desc
```

`loadRegistryConfig()` parses YAML or JSON, validates it against the generic
domain invariants, validates presentation references, and returns a compiled
runtime representation with record-type and field indexes.

No bill-specific vocabulary belongs in this package.
