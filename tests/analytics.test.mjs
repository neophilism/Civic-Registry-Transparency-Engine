import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("analytics repository has distinct public and internal scopes", () => {
  const source = read(
    "packages/database/src/analytics.ts",
  );

  assert.match(source, /AnalyticsScope = "internal" \| "public"/);
  assert.match(source, /record\.public_fields/);
  assert.match(source, /record\.visibility = 'public'/);
  assert.match(source, /civic_registry_record_disclosures/);
  assert.match(source, /event\.visibility = 'public'/);
  assert.match(source, /citation\.visibility = 'public'/);
});

test("field analytics are limited to configured filterable dimensions", () => {
  const source = read("apps/web/lib/analytics.ts");

  assert.match(source, /field\.filterable === true/);
  assert.match(source, /allowed\.some/);
  assert.match(source, /getPublicAnalytics/);
  assert.match(source, /getAdminAnalytics/);
});

test("public and admin analytics surfaces are separate", () => {
  const publicPage = read(
    "apps/web/app/registries/[registryId]/analytics/page.tsx",
  );
  const adminPage = read(
    "apps/web/app/admin/registries/[registryId]/analytics/page.tsx",
  );

  assert.match(publicPage, /getPublicAnalytics/);
  assert.match(publicPage, /Public analytics/);
  assert.match(adminPage, /requireAdminSession/);
  assert.match(adminPage, /getAdminAnalytics/);
});
