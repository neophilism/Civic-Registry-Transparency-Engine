import { readFile } from "node:fs/promises";

import {
  compileRegistryConfig,
  parseRegistryConfig,
  type RegistryConfigFile,
} from "@civic-registry/config";

import { runMigrations } from "./migrations.ts";
import {
  PostgresPublicationLifecycleService,
} from "./lifecycle.ts";
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
    const lifecycle =
      new PostgresPublicationLifecycleService(pool);
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

  throw new Error(
    "Usage: node packages/database/src/cli.ts <migrate|seed|reindex|publish-due> [arguments]",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
