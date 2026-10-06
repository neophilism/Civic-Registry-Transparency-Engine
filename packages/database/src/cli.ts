import { readFile } from "node:fs/promises";

import {
  compileRegistryConfig,
  parseRegistryConfig,
  type RegistryConfigFile,
} from "@civic-registry/config";
import {
  parseIngestionProfile,
  type IngestionFormat,
} from "@civic-registry/ingestion";

import { runMigrations } from "./migrations.ts";
import {
  PostgresPublicationLifecycleService,
} from "./lifecycle.ts";
import {
  PostgresDeadlineService,
} from "./deadlines.ts";
import { createDatabasePool } from "./pool.ts";
import {
  PostgresRegistryConfigRepository,
} from "./repositories.ts";
import {
  rebuildAllSearchIndexes,
  rebuildRegistrySearchIndex,
} from "./search-index.ts";
import {
  seedRegistry,
  type RegistrySeedData,
} from "./seed.ts";
import {
  PostgresIngestionService,
} from "./ingestion.ts";
import {
  PostgresNotificationService,
} from "./notifications.ts";

async function migrate(): Promise<void> {
  const pool = createDatabasePool();

  try {
    const result = await runMigrations(pool);

    console.log(
      JSON.stringify(
        {
          command: "migrate",
          ...result,
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
}

async function seed(
  configPath: string | undefined,
  seedPath: string | undefined,
): Promise<void> {
  if (!configPath || !seedPath) {
    throw new Error(
      "Usage: seed <registry-config.yaml|json> <seed-data.json>",
    );
  }

  const [configSource, seedSource] = await Promise.all([
    readFile(configPath, "utf8"),
    readFile(seedPath, "utf8"),
  ]);

  const config: RegistryConfigFile = parseRegistryConfig(
    configSource,
    {
      sourceName: configPath,
    },
  );
  const seedData = JSON.parse(seedSource) as RegistrySeedData;
  const pool = createDatabasePool();

  try {
    await runMigrations(pool);
    const result = await seedRegistry(pool, config, seedData);

    console.log(
      JSON.stringify(
        {
          command: "seed",
          ...result,
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
}

async function reindex(
  registryId: string | undefined,
): Promise<void> {
  const pool = createDatabasePool();

  try {
    await runMigrations(pool);
    const configs = new PostgresRegistryConfigRepository(pool);

    if (registryId) {
      const config = await configs.get(registryId);

      if (!config) {
        throw new Error(
          `Registry configuration ${registryId} does not exist.`,
        );
      }

      const count = await rebuildRegistrySearchIndex(
        pool,
        compileRegistryConfig(config),
      );

      console.log(
        JSON.stringify(
          {
            command: "reindex",
            registries: {
              [registryId]: count,
            },
          },
          null,
          2,
        ),
      );
      return;
    }

    const result = await rebuildAllSearchIndexes(
      pool,
      configs,
    );

    console.log(
      JSON.stringify(
        {
          command: "reindex",
          registries: result,
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
}

async function publishDue(
  limitValue: string | undefined,
): Promise<void> {
  const limit = limitValue
    ? Number.parseInt(limitValue, 10)
    : undefined;

  if (
    limitValue &&
    (!Number.isInteger(limit) || (limit ?? 0) < 1)
  ) {
    throw new Error(
      "publish-due limit must be a positive integer.",
    );
  }

  const pool = createDatabasePool();

  try {
    await runMigrations(pool);
    const deadlines =
      new PostgresDeadlineService(pool);
    const lifecycle =
      new PostgresPublicationLifecycleService(
        pool,
        deadlines,
      );
    const result = await lifecycle.processDueSchedules({
      limit,
    });

    console.log(
      JSON.stringify(
        {
          command: "publish-due",
          ...result,
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
}

async function reconcileDeadlines(
  registryId: string | undefined,
): Promise<void> {
  if (!registryId) {
    throw new Error(
      "Usage: reconcile-deadlines <registry-id>",
    );
  }

  const pool = createDatabasePool();

  try {
    await runMigrations(pool);
    const deadlines =
      new PostgresDeadlineService(pool);
    const aggregate = {
      records: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
    };
    let offset = 0;

    while (true) {
      const result =
        await deadlines.reconcileRegistry(
          registryId,
          {
            limit: 500,
            offset,
          },
        );

      aggregate.records += result.records;
      aggregate.created += result.created;
      aggregate.updated += result.updated;
      aggregate.unchanged += result.unchanged;

      if (result.records < 500) break;
      offset += result.records;
    }

    console.log(
      JSON.stringify(
        {
          command: "reconcile-deadlines",
          registryId,
          ...aggregate,
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
}

function inferIngestionFormat(
  inputPath: string,
  explicit: string | undefined,
): IngestionFormat {
  if (
    explicit === "json" ||
    explicit === "ndjson" ||
    explicit === "csv"
  ) {
    return explicit;
  }

  const lower = inputPath.toLowerCase();

  if (
    lower.endsWith(".ndjson") ||
    lower.endsWith(".jsonl")
  ) {
    return "ndjson";
  }

  if (lower.endsWith(".csv")) {
    return "csv";
  }

  if (lower.endsWith(".json")) {
    return "json";
  }

  throw new Error(
    "Ingestion format must be json, ndjson, or csv when it cannot be inferred from the input filename.",
  );
}

async function ingest(
  registryId: string | undefined,
  profilePath: string | undefined,
  inputPath: string | undefined,
  formatValue: string | undefined,
  dryRunValue: string | undefined,
): Promise<void> {
  if (!registryId || !profilePath || !inputPath) {
    throw new Error(
      "Usage: ingest <registry-id> <profile.yaml|json> <input-file> [json|ndjson|csv] [--dry-run]",
    );
  }

  const dryRun =
    formatValue === "--dry-run" ||
    dryRunValue === "--dry-run";
  const explicitFormat =
    formatValue === "--dry-run"
      ? undefined
      : formatValue;
  const format = inferIngestionFormat(
    inputPath,
    explicitFormat,
  );
  const [profileSource, inputSource] =
    await Promise.all([
      readFile(profilePath, "utf8"),
      readFile(inputPath, "utf8"),
    ]);
  const pool = createDatabasePool();

  try {
    await runMigrations(pool);
    const configs =
      new PostgresRegistryConfigRepository(pool);
    const config = await configs.get(registryId);

    if (!config) {
      throw new Error(
        `Registry configuration ${registryId} does not exist.`,
      );
    }

    const profile = parseIngestionProfile(
      profileSource,
      compileRegistryConfig(config),
    );
    const service =
      new PostgresIngestionService(pool);
    const result = await service.run({
      registryId,
      profile,
      format,
      input: inputSource,
      sourceLabel: inputPath,
      sourceUri: inputPath,
      dryRun,
      actorId: "system:ingestion-cli",
      reason: dryRun
        ? "CLI ingestion validation run."
        : "CLI ingestion run.",
    });

    console.log(
      JSON.stringify(
        {
          command: "ingest",
          ...result.run,
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
}


async function runNotifications(
  registryId: string | undefined,
): Promise<void> {
  const pool = createDatabasePool();

  try {
    await runMigrations(pool);
    const configs =
      new PostgresRegistryConfigRepository(pool);
    const service =
      new PostgresNotificationService(pool);
    const results: Record<
      string,
      Awaited<ReturnType<
        PostgresNotificationService["run"]
      >>
    > = {};

    if (registryId) {
      results[registryId] =
        await service.run(registryId);
    } else {
      const installed = await configs.list();

      for (const config of installed) {
        if (
          config.notifications?.enabled === true
        ) {
          results[config.registry.id] =
            await service.run(
              config.registry.id,
            );
        }
      }
    }

    console.log(
      JSON.stringify(
        {
          command: "notifications-run",
          registries: results,
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (command === "migrate") {
    await migrate();
    return;
  }

  if (command === "seed") {
    await seed(args[0], args[1]);
    return;
  }

  if (command === "reindex") {
    await reindex(args[0]);
    return;
  }

  if (command === "publish-due") {
    await publishDue(args[0]);
    return;
  }

  if (command === "reconcile-deadlines") {
    await reconcileDeadlines(args[0]);
    return;
  }

  if (command === "ingest") {
    await ingest(
      args[0],
      args[1],
      args[2],
      args[3],
      args[4],
    );
    return;
  }

  if (command === "notifications-run") {
    await runNotifications(args[0]);
    return;
  }

  throw new Error(
    "Usage: node packages/database/src/cli.ts <migrate|seed|reindex|publish-due|reconcile-deadlines|ingest|notifications-run> [arguments]",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
