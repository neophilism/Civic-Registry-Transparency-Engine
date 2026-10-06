# @civic-registry/core

Generic domain primitives for the Civic Registry & Transparency Engine.

This package intentionally contains **no bill-specific concepts**. It defines
the structures that downstream registries compose:

- registry definitions;
- record types and field definitions;
- records and external identifiers;
- typed relationships;
- actors and organizations;
- sources and documents;
- citations;
- tags;
- record versions;
- schema and record validation.

## Domain boundary

A downstream application may define a record type called `legal_interpretation`,
`surveillance_technology`, `federal_program`, or something entirely unrelated.
The core treats each as a configured record type.

The package rejects malformed registry definitions and records before they reach
the persistence layer.

## Example

```ts
import {
  assertValidRegistryDefinition,
  type RegistryDefinition,
} from "@civic-registry/core";

const registry: RegistryDefinition = {
  id: "sample-registry",
  name: "Sample Registry",
  recordTypes: [
    {
      id: "item",
      name: "Item",
      pluralName: "Items",
      titleFieldId: "name",
      fields: [
        {
          id: "name",
          label: "Name",
          type: "text",
          required: true,
          searchable: true,
        },
      ],
    },
  ],
};

assertValidRegistryDefinition(registry);
```
