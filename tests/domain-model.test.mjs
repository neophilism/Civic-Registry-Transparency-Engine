import assert from "node:assert/strict";
import test from "node:test";

import {
  DomainValidationError,
  assertValidRegistryDefinition,
  assertValidRegistryRecord,
  validateRegistryDefinition,
  validateRegistryRecord,
} from "../packages/core/src/index.ts";

const publicationRegistry = {
  id: "publication-catalog",
  name: "Publication Catalog",
  recordTypes: [
    {
      id: "publication",
      name: "Publication",
      pluralName: "Publications",
      titleFieldId: "title",
      summaryFieldId: "abstract",
      fields: [
        {
          id: "title",
          label: "Title",
          type: "text",
          required: true,
          searchable: true,
        },
        {
          id: "abstract",
          label: "Abstract",
          type: "longText",
          searchable: true,
        },
        {
          id: "published_on",
          label: "Published on",
          type: "date",
          filterable: true,
          sortable: true,
        },
      ],
    },
  ],
};

const infrastructureRegistry = {
  id: "infrastructure-inventory",
  name: "Infrastructure Inventory",
  recordTypes: [
    {
      id: "facility",
      name: "Facility",
      pluralName: "Facilities",
      titleFieldId: "name",
      fields: [
        {
          id: "name",
          label: "Name",
          type: "text",
          required: true,
        },
        {
          id: "operational",
          label: "Operational",
          type: "boolean",
          filterable: true,
        },
        {
          id: "capacity",
          label: "Capacity",
          type: "integer",
          sortable: true,
        },
      ],
    },
    {
      id: "operator",
      name: "Operator",
      pluralName: "Operators",
      titleFieldId: "name",
      fields: [
        {
          id: "name",
          label: "Name",
          type: "text",
          required: true,
        },
      ],
    },
  ],
  relationshipTypes: [
    {
      id: "operated-by",
      label: "Operated by",
      inverseLabel: "Operates",
      fromRecordTypeIds: ["facility"],
      toRecordTypeIds: ["operator"],
      directed: true,
    },
  ],
};

const serviceRegistry = {
  id: "service-directory",
  name: "Service Directory",
  recordTypes: [
    {
      id: "service",
      name: "Service",
      pluralName: "Services",
      titleFieldId: "name",
      fields: [
        {
          id: "name",
          label: "Name",
          type: "text",
          required: true,
        },
        {
          id: "delivery_mode",
          label: "Delivery mode",
          type: "multiEnum",
          options: [
            { value: "online", label: "Online" },
            { value: "phone", label: "Phone" },
            { value: "in_person", label: "In person" },
          ],
          filterable: true,
        },
        {
          id: "website",
          label: "Website",
          type: "url",
        },
      ],
    },
  ],
};

test("the same domain model validates substantially different registries", () => {
  for (const registry of [
    publicationRegistry,
    infrastructureRegistry,
    serviceRegistry,
  ]) {
    assert.deepEqual(validateRegistryDefinition(registry), []);
    assert.doesNotThrow(() => assertValidRegistryDefinition(registry));
  }
});

test("registry validation rejects duplicate fields and bad references", () => {
  const invalid = {
    id: "broken-registry",
    name: "Broken Registry",
    defaultRecordTypeId: "missing",
    recordTypes: [
      {
        id: "item",
        name: "Item",
        pluralName: "Items",
        titleFieldId: "missing_title",
        fields: [
          { id: "name", label: "Name", type: "text" },
          { id: "name", label: "Duplicate", type: "text" },
          {
            id: "owner",
            label: "Owner",
            type: "entityRef",
            targetRecordTypeIds: ["unknown_type"],
          },
        ],
      },
    ],
  };

  const issues = validateRegistryDefinition(invalid);
  const codes = new Set(issues.map((issue) => issue.code));

  assert.ok(codes.has("duplicate_field_id"));
  assert.ok(codes.has("unknown_title_field"));
  assert.ok(codes.has("unknown_record_type_reference"));
  assert.ok(codes.has("unknown_default_record_type"));
});

test("record validation enforces required and configured field types", () => {
  const record = {
    id: "service-1",
    registryId: "service-directory",
    recordTypeId: "service",
    status: "published",
    visibility: "public",
    fields: {
      name: "Public information line",
      delivery_mode: ["online", "carrier_pigeon"],
      website: "not a url",
      undeclared: "not allowed",
    },
    createdAt: "2026-10-05T12:00:00Z",
    updatedAt: "2026-10-05T12:00:00Z",
  };

  const issues = validateRegistryRecord(record, serviceRegistry);
  const codes = new Set(issues.map((issue) => issue.code));

  assert.ok(codes.has("invalid_field_value"));
  assert.ok(codes.has("unknown_field"));
});

test("a valid record passes schema validation", () => {
  const record = {
    id: "service-2",
    registryId: "service-directory",
    recordTypeId: "service",
    status: "published",
    visibility: "public",
    fields: {
      name: "Permit assistance",
      delivery_mode: ["online", "in_person"],
      website: "https://example.gov/services/permit-assistance",
    },
    createdAt: "2026-10-05T12:00:00Z",
    updatedAt: "2026-10-05T12:30:00Z",
    publishedAt: "2026-10-05T12:30:00Z",
  };

  assert.deepEqual(validateRegistryRecord(record, serviceRegistry), []);
  assert.doesNotThrow(() =>
    assertValidRegistryRecord(record, serviceRegistry),
  );
});

test("assert helpers expose structured validation issues", () => {
  const invalidRegistry = {
    id: "Invalid Registry ID",
    name: "",
    recordTypes: [],
  };

  assert.throws(
    () => assertValidRegistryDefinition(invalidRegistry),
    (error) => {
      assert.ok(error instanceof DomainValidationError);
      assert.ok(error.issues.length >= 3);
      return true;
    },
  );
});
