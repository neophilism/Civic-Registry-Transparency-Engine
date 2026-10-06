import { Pool, type PoolConfig } from "pg";

export interface CreateDatabasePoolOptions {
  connectionString?: string;
  max?: number;
  applicationName?: string;
}

export function createDatabasePool(
  options: CreateDatabasePoolOptions = {},
): Pool {
  const connectionString =
    options.connectionString ?? process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is required to create the PostgreSQL connection pool.",
    );
  }

  const config: PoolConfig = {
    connectionString,
    max: options.max ?? 10,
    application_name:
      options.applicationName ?? "civic-registry-transparency-engine",
  };

  return new Pool(config);
}
