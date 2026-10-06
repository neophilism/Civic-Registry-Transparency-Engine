import {
  createDatabasePool,
  PostgresRecordRepository,
  PostgresRegistryConfigRepository,
  PostgresRelationshipRepository,
} from "@civic-registry/database";
import type { Pool } from "pg";

type DatabaseGlobal = typeof globalThis & {
  __civicRegistryPool?: Pool;
};

const databaseGlobal = globalThis as DatabaseGlobal;

export function getDatabasePool(): Pool {
  if (!databaseGlobal.__civicRegistryPool) {
    databaseGlobal.__civicRegistryPool = createDatabasePool({
      applicationName: "civic-registry-web",
    });
  }

  return databaseGlobal.__civicRegistryPool;
}

export function getRepositories() {
  const pool = getDatabasePool();
  const configs = new PostgresRegistryConfigRepository(pool);
  const records = new PostgresRecordRepository(pool, configs);
  const relationships = new PostgresRelationshipRepository(
    pool,
    configs,
    records,
  );

  return {
    configs,
    records,
    relationships,
  };
}
