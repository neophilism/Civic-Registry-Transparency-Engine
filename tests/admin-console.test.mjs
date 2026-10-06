import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) =>
  fs.readFileSync(path, "utf8");

test("administrator console is guarded and routes lifecycle through services", () => {
  const auth = read(
    "apps/web/lib/admin-auth.ts",
  );
  const actions = read(
    "apps/web/app/admin/actions.ts",
  );
  const recordPage = read(
    "apps/web/app/admin/registries/[registryId]/records/[recordId]/page.tsx",
  );

  assert.match(
    auth,
    /CIVIC_REGISTRY_ADMIN_TOKEN/,
  );
  assert.match(auth, /httpOnly: true/);
  assert.match(auth, /sameSite: "strict"/);
  assert.match(
    actions,
    /PostgresPublicationLifecycleService/,
  );
  assert.match(
    actions,
    /repositories\.records\.update/,
  );
  assert.doesNotMatch(
    recordPage,
    /name="status"/,
  );
});

test("administrator console surfaces required operational areas", () => {
  const page = read(
    "apps/web/app/admin/registries/[registryId]/page.tsx",
  );

  for (const expected of [
    "Pending approvals",
    "Open obligations",
    "Recent runs and failures",
    "Sources",
    "Schema validation",
  ]) {
    assert.match(page, new RegExp(expected));
  }
});

test("database admin repository remains domain-neutral", () => {
  const admin = read(
    "packages/database/src/admin.ts",
  );

  assert.match(
    admin,
    /getRegistrySummary/,
  );
  assert.match(
    admin,
    /listTransitionRequests/,
  );
  assert.match(admin, /listDeadlines/);
  assert.doesNotMatch(
    admin,
    /surveillance|weapon|bill|campaign|election/i,
  );
});
