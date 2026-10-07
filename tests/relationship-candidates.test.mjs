import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  relationshipCandidateEvidenceHash,
} from "../packages/database/src/relationship-candidates.ts";

test("relationship candidate evidence hashing is stable across object key order", () => {
  const left = relationshipCandidateEvidenceHash({
    source: "document",
    details: {
      page: 3,
      identifier: "example-123",
    },
    tags: ["a", "b"],
  });
  const right = relationshipCandidateEvidenceHash({
    tags: ["a", "b"],
    details: {
      identifier: "example-123",
      page: 3,
    },
    source: "document",
  });

  assert.equal(left, right);
});

test("generic relationship-candidate engine remains domain neutral", () => {
  const service = fs.readFileSync(
    "packages/database/src/relationship-candidates.ts",
    "utf8",
  );
  const migration = fs.readFileSync(
    "packages/database/migrations/0013_relationship_candidates.sql",
    "utf8",
  );
  const admin = fs.readFileSync(
    "apps/web/app/admin/registries/[registryId]/relationship-candidates/page.tsx",
    "utf8",
  );
  const generic = [service, migration, admin].join("\n");

  assert.match(
    service,
    /relationship_candidate\.proposed/,
  );
  assert.match(service, /pg_advisory_xact_lock/);
  assert.match(admin, /Approve relationship/);
  assert.doesNotMatch(
    generic,
    /specific agency|specific statute|surveillance technology|legal authority/i,
  );
});
