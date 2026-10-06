import type {
  RegistryRecord,
  Relationship,
} from "@civic-registry/core";
import type { RegistryConfigFile } from "@civic-registry/config";
import type { Pool } from "pg";

import {
  PostgresRecordRepository,
  PostgresRegistryConfigRepository,
  PostgresRelationshipRepository,
} from "./repositories.ts";

export interface RegistrySeedData {
  records?: RegistryRecord[];
  relationships?: Relationship[];
}

export interface SeedResult {
  registryId: string;
  recordsCreated: number;
  recordsUpdated: number;
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
  const relationships = new PostgresRelationshipRepository(
    pool,
    configs,
    records,
  );

  await configs.upsert(config);

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
    recordsCreated,
    recordsUpdated,
    relationshipsCreated,
    relationshipsReplaced,
  };
}
