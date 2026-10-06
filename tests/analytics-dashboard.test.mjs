import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) =>
  fs.readFileSync(path, "utf8");

test("analytics expose separate public and administrative scopes", () => {
  const publicPage = read(
    "apps/web/app/registries/[registryId]/analytics/page.tsx",
  );
  const adminPage = read(
    "apps/web/app/admin/registries/[registryId]/analytics/page.tsx",
  );
  const repository = read(
    "packages/database/src/analytics.ts",
  );

  assert.match(publicPage, /scope: "public"/);
  assert.match(
    adminPage,
    /scope: "administrative"/,
  );
  assert.match(
    adminPage,
    /requireAdminSession/,
  );
  assert.match(
    repository,
    /civic_registry_record_disclosures/,
  );
  assert.match(
    repository,
    /civic_registry_field_disclosures/,
  );
});

test("analytics remain configuration-driven and domain-neutral", () => {
  const repository = read(
    "packages/database/src/analytics.ts",
  );
  const types = read(
    "packages/config/src/types.ts",
  );

  assert.match(types, /AnalyticsDimensionConfig/);
  assert.match(repository, /dimensionBreakdowns/);
  assert.doesNotMatch(
    repository,
    /campaign|election|surveillance|weapon|bill/i,
  );
});
