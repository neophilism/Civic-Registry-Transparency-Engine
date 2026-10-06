import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  compileRegistryConfig,
  parseRegistryConfig,
  validateRegistryConfig,
} from "../packages/config/src/index.ts";
import {
  parseIngestionProfile,
} from "../packages/ingestion/src/index.ts";

const configSource = fs.readFileSync(
  "examples/open-legal-interpretations/registry.yaml",
  "utf8",
);
const config = parseRegistryConfig(configSource, {
  sourceName:
    "examples/open-legal-interpretations/registry.yaml",
});
const compiled = compileRegistryConfig(config);

test("Open Legal Interpretations is a valid thin registry configuration", () => {
  assert.deepEqual(
    validateRegistryConfig(config),
    [],
  );
  assert.equal(
    config.registry.id,
    "open-legal-interpretations",
  );
  assert.deepEqual(
    [...compiled.recordTypesById.keys()],
    [
      "interpretation",
      "issuing_body",
      "legal_authority",
    ],
  );
  assert.ok(
    compiled.relationshipTypesById.has(
      "supersedes",
    ),
  );
  assert.ok(
    compiled.relationshipTypesById.has(
      "interprets-authority",
    ),
  );
  assert.ok(
    compiled.deadlines?.definitionsById.has(
      "declassification_review_due",
    ),
  );
  assert.equal(
    compiled.disclosure.withheldRecordBehavior,
    "placeholder",
  );
  assert.equal(
    compiled.notifications.enabled,
    true,
  );
});

test("Open Legal Interpretations ingestion profile compiles against the generic schema", () => {
  const profileSource = fs.readFileSync(
    "examples/open-legal-interpretations/import-profile.yaml",
    "utf8",
  );
  const profile = parseIngestionProfile(
    profileSource,
    compiled,
  );

  assert.equal(
    profile.recordTypeId,
    "interpretation",
  );
  assert.equal(profile.mode, "upsert");
  assert.equal(
    profile.allowLifecycleBootstrap,
    true,
  );
  assert.ok(
    "legal_authorities" in profile.fields,
  );
  assert.ok(
    "full_text" in profile.fields,
  );
});

test("reference application presentation reuses generic engine services", () => {
  const page = fs.readFileSync(
    "apps/web/app/open-legal-interpretations/page.tsx",
    "utf8",
  );

  assert.match(page, /getPublicRegistry/);
  assert.match(page, /listPublicRecords/);
  assert.match(page, /getPublicAnalytics/);
  assert.match(
    page,
    /Civic Registry &amp; Transparency Engine/,
  );
});
