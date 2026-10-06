import type {
  Citation,
  Document,
  RegistryRecord,
  Relationship,
  Source,
} from "@civic-registry/core";
import type { RegistryConfigFile } from "@civic-registry/config";
import type { Pool } from "pg";

import {
  PostgresCitationRepository,
  PostgresDocumentRepository,
  PostgresSourceRepository,
} from "./evidence.ts";
import {
  PostgresRecordRepository,
  PostgresRegistryConfigRepository,
  PostgresRelationshipRepository,
} from "./repositories.ts";

export interface RegistrySeedData {
  sources?: Source[];
  documents?: Document[];
  records?: RegistryRecord[];
  citations?: Citation[];
  relationships?: Relationship[];
}

export interface SeedResult {
  registryId: string;
  sourcesCreated: number;
  sourcesUpdated: number;
  documentsCreated: number;
  documentsUpdated: number;
  recordsCreated: number;
  recordsUpdated: number;
  citationsCreated: number;
  citationsUpdated: number;
  relationshipsCreated: number;
  relationshipsReplaced: number;
}

export async function seedRegistry(
  pool: Pool,
  config: RegistryConfigFile,
  seed: RegistrySeedData,
): Promise<SeedResult> {
  const configs = new PostgresRegistryConfigRepository(pool);
  const records = new PostgresRecordRepository(pool, configs);
  const sources = new PostgresSourceRepository(pool, configs);
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
  const relationships = new PostgresRelationshipRepository(
    pool,
    configs,
    records,
  );

  await configs.upsert(config);

  let sourcesCreated = 0;
  let sourcesUpdated = 0;

  for (const source of seed.sources ?? []) {
    if (source.registryId !== config.registry.id) {
      throw new Error(
        `Seed source ${source.id} belongs to ${source.registryId}, expected ${config.registry.id}.`,
      );
    }

    const existing = await sources.get(
      source.registryId,
      source.id,
    );

    if (existing) {
      await sources.update(source);
      sourcesUpdated += 1;
    } else {
      await sources.create(source);
      sourcesCreated += 1;
    }
  }

  let documentsCreated = 0;
  let documentsUpdated = 0;

  for (const document of seed.documents ?? []) {
    if (document.registryId !== config.registry.id) {
      throw new Error(
        `Seed document ${document.id} belongs to ${document.registryId}, expected ${config.registry.id}.`,
      );
    }

    const existing = await documents.get(
      document.registryId,
      document.id,
    );

    if (existing) {
      await documents.update(document);
      documentsUpdated += 1;
    } else {
      await documents.create(document);
      documentsCreated += 1;
    }
  }

  let recordsCreated = 0;
  let recordsUpdated = 0;

  for (const record of seed.records ?? []) {
    if (record.registryId !== config.registry.id) {
      throw new Error(
        `Seed record ${record.id} belongs to ${record.registryId}, expected ${config.registry.id}.`,
      );
    }

    const existing = await records.get(
      record.registryId,
      record.id,
    );

    if (existing) {
      await records.update(record);
      recordsUpdated += 1;
    } else {
      await records.create(record);
      recordsCreated += 1;
    }
  }

  let citationsCreated = 0;
  let citationsUpdated = 0;

  for (const citation of seed.citations ?? []) {
    if (citation.registryId !== config.registry.id) {
      throw new Error(
        `Seed citation ${citation.id} belongs to ${citation.registryId}, expected ${config.registry.id}.`,
      );
    }

    const existing = await citations.get(
      citation.registryId,
      citation.id,
    );

    if (existing) {
      await citations.update(citation);
      citationsUpdated += 1;
    } else {
      await citations.create(citation);
      citationsCreated += 1;
    }
  }

  let relationshipsCreated = 0;
  let relationshipsReplaced = 0;

  for (const relationship of seed.relationships ?? []) {
    if (relationship.registryId !== config.registry.id) {
      throw new Error(
        `Seed relationship ${relationship.id} belongs to ${relationship.registryId}, expected ${config.registry.id}.`,
      );
    }

    const existing = await relationships.get(
      relationship.registryId,
      relationship.id,
    );

    if (existing) {
      const unchanged =
        existing.relationshipTypeId ===
          relationship.relationshipTypeId &&
        existing.fromRecordId ===
          relationship.fromRecordId &&
        existing.toRecordId ===
          relationship.toRecordId &&
        existing.createdAt ===
          relationship.createdAt &&
        JSON.stringify(existing.metadata ?? {}) ===
          JSON.stringify(relationship.metadata ?? {});

      if (unchanged) {
        continue;
      }

      await relationships.delete(
        relationship.registryId,
        relationship.id,
      );
      relationshipsReplaced += 1;
    } else {
      relationshipsCreated += 1;
    }

    await relationships.create(relationship);
  }

  return {
    registryId: config.registry.id,
    sourcesCreated,
    sourcesUpdated,
    documentsCreated,
    documentsUpdated,
    recordsCreated,
    recordsUpdated,
    citationsCreated,
    citationsUpdated,
    relationshipsCreated,
    relationshipsReplaced,
  };
}
