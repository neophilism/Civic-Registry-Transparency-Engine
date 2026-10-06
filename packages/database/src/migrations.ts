import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Pool, PoolClient } from "pg";

const MIGRATION_FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;
const MIGRATION_LOCK_ID = 724918531;

export interface MigrationFile {
  id: string;
  name: string;
  path: string;
  sql: string;
  checksum: string;
}

export interface AppliedMigration {
  id: string;
  name: string;
  checksum: string;
  appliedAt: string;
}

export interface MigrationResult {
  applied: string[];
  alreadyApplied: string[];
}

export function defaultMigrationDirectory(): string {
  return join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "migrations",
  );
}

function checksum(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

export async function readMigrations(
  migrationDirectory = defaultMigrationDirectory(),
): Promise<MigrationFile[]> {
  const entries = await readdir(migrationDirectory);
  const migrationNames = entries
    .filter((entry) => entry.endsWith(".sql"))
    .sort();

  const migrations: MigrationFile[] = [];
  const seenIds = new Set<string>();

  for (const name of migrationNames) {
    const match = MIGRATION_FILE_PATTERN.exec(name);

    if (!match) {
      throw new Error(
        `Invalid migration filename "${name}". Expected NNNN_description.sql.`,
      );
    }

    const [, id] = match;

    if (seenIds.has(id)) {
      throw new Error(`Duplicate migration id: ${id}.`);
    }

    seenIds.add(id);

    const path = join(migrationDirectory, name);
    const sql = await readFile(path, "utf8");

    if (sql.trim().length === 0) {
      throw new Error(`Migration ${name} is empty.`);
    }

    migrations.push({
      id,
      name,
      path,
      sql,
      checksum: checksum(sql),
    });
  }

  return migrations;
}

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS civic_registry_schema_migrations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(
  client: PoolClient,
): Promise<Map<string, AppliedMigration>> {
  const result = await client.query<{
    id: string;
    name: string;
    checksum: string;
    applied_at: Date;
  }>(`
    SELECT id, name, checksum, applied_at
    FROM civic_registry_schema_migrations
    ORDER BY id
  `);

  return new Map(
    result.rows.map((row) => [
      row.id,
      {
        id: row.id,
        name: row.name,
        checksum: row.checksum,
        appliedAt: row.applied_at.toISOString(),
      },
    ]),
  );
}

export async function runMigrations(
  pool: Pool,
  migrationDirectory = defaultMigrationDirectory(),
): Promise<MigrationResult> {
  const migrations = await readMigrations(migrationDirectory);
  const client = await pool.connect();

  try {
    await client.query(
      "SELECT pg_advisory_lock($1)",
      [MIGRATION_LOCK_ID],
    );
    await ensureMigrationTable(client);

    const applied = await getAppliedMigrations(client);
    const newlyApplied: string[] = [];
    const alreadyApplied: string[] = [];

    for (const migration of migrations) {
      const existing = applied.get(migration.id);

      if (existing) {
        if (existing.checksum !== migration.checksum) {
          throw new Error(
            `Migration ${migration.name} was modified after being applied.`,
          );
        }

        alreadyApplied.push(migration.name);
        continue;
      }

      await client.query("BEGIN");

      try {
        await client.query(migration.sql);
        await client.query(
          `
            INSERT INTO civic_registry_schema_migrations
              (id, name, checksum)
            VALUES ($1, $2, $3)
          `,
          [migration.id, migration.name, migration.checksum],
        );
        await client.query("COMMIT");
        newlyApplied.push(migration.name);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    return {
      applied: newlyApplied,
      alreadyApplied,
    };
  } finally {
    try {
      await client.query(
        "SELECT pg_advisory_unlock($1)",
        [MIGRATION_LOCK_ID],
      );
    } finally {
      client.release();
    }
  }
}
