import {
  createDatabasePool,
  PostgresAdminRepository,
  PostgresAnalyticsRepository,
  PostgresCitationRepository,
  PostgresIntegrityService,
  PostgresDeadlineService,
  PostgresDisclosureRepository,
  PostgresDocumentRepository,
  PostgresRecordHistoryRepository,
  PostgresRecordRepository,
  PostgresRegistryConfigRepository,
  PostgresRelationshipCandidateService,
  PostgresRelationshipGraphRepository,
  PostgresRelationshipRepository,
  PostgresSearchProvider,
  PostgresSourceRepository,
  PostgresSourceRefreshService,
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
  const admin = new PostgresAdminRepository(pool);
  const analytics = new PostgresAnalyticsRepository(pool);
  const integrity = new PostgresIntegrityService(pool);
  const deadlines = new PostgresDeadlineService(pool);
  const records = new PostgresRecordRepository(
    pool,
    configs,
    deadlines,
  );
  const history = new PostgresRecordHistoryRepository(pool);
  const relationships = new PostgresRelationshipRepository(
    pool,
    configs,
    records,
  );
  const relationshipGraph =
    new PostgresRelationshipGraphRepository(pool);
  const sources = new PostgresSourceRepository(
    pool,
    configs,
  );
  const documents = new PostgresDocumentRepository(
    pool,
    configs,
    sources,
  );
  const citations = new PostgresCitationRepository(
    pool,
    configs,
    records,
    sources,
    documents,
  );
  const disclosure = new PostgresDisclosureRepository(
    pool,
    configs,
    records,
    documents,
  );
  const search = new PostgresSearchProvider(pool);
  const sourceRefresh = new PostgresSourceRefreshService(pool);

  return {
    admin,
    analytics,
    integrity,
    configs,
    deadlines,
    records,
    history,
    relationships,
    relationshipCandidates,
    relationshipGraph,
    sources,
    documents,
    citations,
    disclosure,
    search,
    sourceRefresh,
  };
}
