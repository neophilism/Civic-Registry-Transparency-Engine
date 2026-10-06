import {
  compileRegistryConfig,
  type CompiledRegistryConfig,
} from "@civic-registry/config";
import type { RegistryRecord } from "@civic-registry/core";
import {
  buildRecordSearchText,
} from "@civic-registry/search";
import type {
  Pool,
  QueryResultRow,
} from "pg";

import type {
  RegistryConfigRepository,
} from "./repositories.ts";

interface ReindexRow extends QueryResultRow {
  registry_id: string;
  id: string;
  record_type_id: string;
  fields: RegistryRecord["fields"];
  status: string;
  visibility: RegistryRecord["visibility"];
  external_identifiers: RegistryRecord["externalIdentifiers"];
  tags: string[];
  created_at: Date;
  updated_at: Date;
  published_at: Date | null;
}

function mapRecord(row: ReindexRow): RegistryRecord {
  return {
    id: row.id,
    registryId: row.registry_id,
    recordTypeId: row.record_type_id,
    fields: row.fields,
    status: row.status,
    visibility: row.visibility,
    externalIdentifiers: row.external_identifiers ?? [],
    tags: row.tags ?? [],
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    publishedAt: row.published_at?.toISOString(),
  };
}

export async function rebuildRegistrySearchIndex(
  pool: Pool,
  registry: CompiledRegistryConfig,
): Promise<number> {
  const result = await pool.query<ReindexRow>(
    `
      SELECT *
      FROM civic_registry_records
      WHERE registry_id = $1
      ORDER BY id
    `,
    [registry.definition.id],
  );

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (const row of result.rows) {
      const record = mapRecord(row);
      const searchText = buildRecordSearchText(
        record,
        registry,
      );

      await client.query(
        `
          UPDATE civic_registry_records
          SET
            search_text = $3,
            public_search_text =
              civic_registry_public_record_search_text(
                registry_id,
                id,
                record_type_id,
                tags,
                public_fields
              )
          WHERE registry_id = $1 AND id = $2
        `,
        [record.registryId, record.id, searchText],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return result.rows.length;
}

export async function rebuildAllSearchIndexes(
  pool: Pool,
  configs: RegistryConfigRepository,
): Promise<Record<string, number>> {
  const result: Record<string, number> = {};

  for (const config of await configs.list()) {
    const registry = compileRegistryConfig(config);
    result[registry.definition.id] =
      await rebuildRegistrySearchIndex(
        pool,
        registry,
      );
  }

  return result;
}
