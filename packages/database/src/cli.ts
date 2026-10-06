import { readFile } from "node:fs/promises";

import {
  parseRegistryConfig,
  type RegistryConfigFile,
} from "@civic-registry/config";

import { runMigrations } from "./migrations.ts";
import { createDatabasePool } from "./pool.ts";
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

  throw new Error(
    "Usage: node packages/database/src/cli.ts <migrate|seed> [arguments]",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
