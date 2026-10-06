import {
  readFile,
  writeFile,
} from "node:fs/promises";

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
import {
  PostgresIntegrityService,
  type SignedIntegrityCheckpoint,
} from "./integrity.ts";

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


async function loadIntegrityKey(
  kind: "private" | "public",
): Promise<string> {
  const prefix =
    "CIVIC_REGISTRY_INTEGRITY_" +
    kind.toUpperCase();
  const filePath =
    process.env[prefix + "_KEY_FILE"]?.trim();
  const inline =
    process.env[prefix + "_KEY"]?.trim();

  if (filePath) {
    return readFile(filePath, "utf8");
  }

  if (inline) {
    return inline.includes("\\n")
      ? inline.replaceAll("\\n", "\n")
      : inline;
  }

  throw new Error(
    `Missing ${prefix}_KEY_FILE or ${prefix}_KEY.`,
  );
}

function parseCheckpoint(
  source: string,
): SignedIntegrityCheckpoint {
  const value = JSON.parse(source) as unknown;

  if (
    !value ||
    typeof value !== "object" ||
    !("formatVersion" in value) ||
    !("registryId" in value) ||
    !("sequence" in value) ||
    !("signature" in value)
  ) {
    throw new Error(
      "Integrity checkpoint JSON has an invalid shape.",
    );
  }

  return value as SignedIntegrityCheckpoint;
}

async function verifyIntegrity(
  registryId: string | undefined,
  checkpointPath: string | undefined,
  backupFilePath: string | undefined,
): Promise<void> {
  const pool = createDatabasePool();

  try {
    await runMigrations(pool);
    const service =
      new PostgresIntegrityService(pool);

    if (checkpointPath) {
      const checkpoint = parseCheckpoint(
        await readFile(checkpointPath, "utf8"),
      );

      if (
        registryId &&
        checkpoint.registryId !== registryId
      ) {
        throw new Error(
          `Checkpoint registry ${checkpoint.registryId} does not match requested registry ${registryId}.`,
        );
      }

      const publicKey =
        await loadIntegrityKey("public");
      const result =
        await service.verifySignedCheckpoint(
          checkpoint,
          publicKey,
          {
            backupFilePath,
          },
        );

      console.log(
        JSON.stringify(
          {
            command: "integrity-verify",
            checkpoint: checkpointPath,
            registryId:
              checkpoint.registryId,
            ...result,
          },
          null,
          2,
        ),
      );

      if (!result.valid) {
        process.exitCode = 2;
      }

      return;
    }

    if (registryId) {
      const result =
        await service.verifyRegistry(registryId);

      console.log(
        JSON.stringify(
          {
            command: "integrity-verify",
            registryId,
            ...result,
          },
          null,
          2,
        ),
      );

      if (!result.valid) {
        process.exitCode = 2;
      }

      return;
    }

    const configs =
      new PostgresRegistryConfigRepository(pool);
    const installed = await configs.list();
    const results: Record<
      string,
      Awaited<ReturnType<
        PostgresIntegrityService["verifyRegistry"]
      >>
    > = {};
    let valid = true;

    for (const config of installed) {
      const result =
        await service.verifyRegistry(
          config.registry.id,
        );
      results[config.registry.id] = result;
      valid = valid && result.valid;
    }

    console.log(
      JSON.stringify(
        {
          command: "integrity-verify",
          registries: results,
          valid,
        },
        null,
        2,
      ),
    );

    if (!valid) {
      process.exitCode = 2;
    }
  } finally {
    await pool.end();
  }
}

async function createIntegrityCheckpoint(
  registryId: string | undefined,
  outputPath: string | undefined,
  backupFilePath: string | undefined,
): Promise<void> {
  if (!registryId || !outputPath) {
    throw new Error(
      "Usage: integrity-checkpoint <registry-id> <output.json> [backup-file]",
    );
  }

  const privateKey =
    await loadIntegrityKey("private");
  const pool = createDatabasePool();

  try {
    await runMigrations(pool);
    const service =
      new PostgresIntegrityService(pool);
    const checkpoint =
      await service.createSignedCheckpoint(
        registryId,
        privateKey,
        {
          keyId:
            process.env
              .CIVIC_REGISTRY_INTEGRITY_KEY_ID,
          backupFilePath,
        },
      );

    await writeFile(
      outputPath,
      JSON.stringify(checkpoint, null, 2) +
        "\n",
      {
        encoding: "utf8",
        mode: 0o644,
      },
    );

    console.log(
      JSON.stringify(
        {
          command: "integrity-checkpoint",
          registryId,
          outputPath,
          sequence: checkpoint.sequence,
          headHash: checkpoint.headHash,
          keyId: checkpoint.keyId,
          backup: checkpoint.backup,
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

  if (command === "integrity-verify") {
    await verifyIntegrity(
      args[0],
      args[1],
      args[2],
    );
    return;
  }

  if (command === "integrity-checkpoint") {
    await createIntegrityCheckpoint(
      args[0],
      args[1],
      args[2],
    );
    return;
  }

  throw new Error(
    "Usage: node packages/database/src/cli.ts <migrate|seed|reindex|publish-due|reconcile-deadlines|ingest|notifications-run|integrity-verify|integrity-checkpoint> [arguments]",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
