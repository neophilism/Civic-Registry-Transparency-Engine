import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  RegistryConfigError,
  compileRegistryConfig,
  loadRegistryConfig,
  validateRegistryConfig,
} from "../packages/config/src/index.ts";

const minimalYaml = `
schemaVersion: 1
registry:
  id: simple-catalog
  name: Simple Catalog
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
        - id: rank
          label: Rank
          type: integer
          sortable: true
presentation:
  recordTypes:
    item:
      listFields: [name, rank]
      defaultSort:
        fieldId: rank
        direction: desc
`;

test("loads and compiles YAML into indexed runtime configuration", () => {
  const compiled = loadRegistryConfig(minimalYaml);

  assert.equal(compiled.definition.id, "simple-catalog");
  assert.equal(compiled.getRecordType("item").definition.name, "Item");
  assert.equal(compiled.getField("item", "rank").type, "integer");
  assert.deepEqual(
    compiled.getRecordType("item").listFields.map((field) => field.id),
    ["name", "rank"],
  );
  assert.deepEqual(compiled.getRecordType("item").defaultSort, {
    fieldId: "rank",
    direction: "desc",
  });
});

test("derives generic form controls from configured field types", () => {
  const compiled = loadRegistryConfig(minimalYaml);
  const fields = compiled.getRecordType("item").formFields;

  assert.deepEqual(
    fields.map(({ id, control, required }) => ({
      id,
      control,
      required,
    })),
    [
      { id: "name", control: "text", required: true },
      { id: "rank", control: "number", required: false },
    ],
  );
});

test("supports JSON using the same configuration contract", () => {
  const config = {
    schemaVersion: 1,
    registry: {
      id: "json-registry",
      name: "JSON Registry",
      recordTypes: [
        {
          id: "entry",
          name: "Entry",
          pluralName: "Entries",
          titleFieldId: "title",
          fields: [
            {
              id: "title",
              label: "Title",
              type: "text",
              required: true,
            },
          ],
        },
      ],
    },
  };

  const compiled = loadRegistryConfig(JSON.stringify(config));

  assert.equal(compiled.definition.id, "json-registry");
});

test("rejects presentation references to fields that do not exist", () => {
  const invalid = {
    schemaVersion: 1,
    registry: {
      id: "bad-presentation",
      name: "Bad Presentation",
      recordTypes: [
        {
          id: "entry",
          name: "Entry",
          pluralName: "Entries",
          titleFieldId: "title",
          fields: [
            {
              id: "title",
              label: "Title",
              type: "text",
              required: true,
            },
          ],
        },
      ],
    },
    presentation: {
      recordTypes: {
        entry: {
          listFields: ["title", "missing"],
        },
      },
    },
  };

  const issues = validateRegistryConfig(invalid);
  assert.ok(
    issues.some((issue) => issue.code === "unknown_presentation_field"),
  );
});

test("rejects default sorting by a field not declared sortable", () => {
  const invalid = {
    schemaVersion: 1,
    registry: {
      id: "bad-sort",
      name: "Bad Sort",
      recordTypes: [
        {
          id: "entry",
          name: "Entry",
          pluralName: "Entries",
          titleFieldId: "title",
          fields: [
            {
              id: "title",
              label: "Title",
              type: "text",
              required: true,
            },
          ],
        },
      ],
    },
    presentation: {
      recordTypes: {
        entry: {
          defaultSort: {
            fieldId: "title",
          },
        },
      },
    },
  };

  const issues = validateRegistryConfig(invalid);
  assert.ok(
    issues.some((issue) => issue.code === "unsortable_default_field"),
  );
});

test("returns structured YAML parse errors", () => {
  assert.throws(
    () =>
      loadRegistryConfig("schemaVersion: [", {
        sourceName: "broken.yaml",
      }),
    (error) => {
      assert.ok(error instanceof RegistryConfigError);
      assert.equal(error.issues[0].code, "yaml_parse_error");
      return true;
    },
  );
});

test("the checked-in example compiles without application code", async () => {
  const source = await readFile(
    "examples/generic-registry/registry.yaml",
    "utf8",
  );
  const compiled = loadRegistryConfig(source, {
    sourceName: "examples/generic-registry/registry.yaml",
  });

  assert.equal(compiled.definition.id, "public-document-catalog");
  assert.equal(compiled.recordTypesById.size, 2);
  assert.equal(compiled.relationshipTypesById.size, 1);
  assert.ok(compiled.publicationLifecycle);
  assert.equal(
    compiled.publicationLifecycle.definition.initialStatusId,
    "draft",
  );
  assert.equal(
    compiled.publicationLifecycle.getStatus("published").label,
    "Published",
  );
  assert.equal(
    compiled.publicationLifecycle.isPublicStatus("approved"),
    false,
  );
  assert.equal(
    compiled.publicationLifecycle.isPublicStatus("published"),
    true,
  );
  assert.equal(
    compiled.getRecordType("document").defaultSort?.fieldId,
    "published_on",
  );
});

test("compileRegistryConfig accepts validated object configuration directly", () => {
  const objectConfig = {
    schemaVersion: 1,
    registry: {
      id: "object-registry",
      name: "Object Registry",
      recordTypes: [
        {
          id: "entry",
          name: "Entry",
          pluralName: "Entries",
          titleFieldId: "title",
          fields: [
            {
              id: "title",
              label: "Title",
              type: "text",
            },
          ],
        },
      ],
    },
  };

  assert.equal(
    compileRegistryConfig(objectConfig).definition.name,
    "Object Registry",
  );
});
