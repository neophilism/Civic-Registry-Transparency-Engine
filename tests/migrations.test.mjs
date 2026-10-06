import assert from "node:assert/strict";
import test from "node:test";

import {
  readMigrations,
} from "../packages/database/src/index.ts";

test("database migrations have valid ordered names and checksums", async () => {
  const migrations = await readMigrations();

  assert.ok(migrations.length >= 1);
  assert.deepEqual(
    migrations.map((migration) => migration.id),
    [...migrations.map((migration) => migration.id)].sort(),
  );

  for (const migration of migrations) {
    assert.match(migration.name, /^\d{4}_[a-z0-9_]+\.sql$/);
    assert.match(migration.checksum, /^[a-f0-9]{64}$/);
    assert.ok(migration.sql.trim().length > 0);
  }
});
