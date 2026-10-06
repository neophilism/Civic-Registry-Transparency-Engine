
import {
  readFile,
} from "node:fs/promises";

import {
  compileRegistryConfig,
} from "@civic-registry/config";
import {
  createDatabasePool,
  PostgresIngestionService,
  PostgresRegistryConfigRepository,
  PostgresSourceRefreshService,
  runMigrations,
  type SourceRefreshClaim,
} from "@civic-registry/database";
import {
  parseIngestionProfile,
} from "@civic-registry/ingestion";
import {
  runSourceAdapter,
  type SourceAdapter,
} from "@civic-registry/source-adapters";

import {
  dojOlcAdapter,
  ogeLegalAdvisoriesAdapter,
} from "./index.ts";
import {
  openLegalInterpretationsRefreshJobs,
} from "./refresh-jobs.ts";

const REGISTRY_ID =
  "open-legal-interpretations";
const PROFILE_PATH =
  "examples/open-legal-interpretations/adapter-import-profile.yaml";

const adapters = new Map<
  string,
  SourceAdapter
>([
  [
    dojOlcAdapter.id,
    dojOlcAdapter,
  ],
  [
    ogeLegalAdvisoriesAdapter.id,
    ogeLegalAdvisoriesAdapter,
  ],
]);

async function makeExecutor(
  pool: ReturnType<
    typeof createDatabasePool
  >,
) {
  const configs =
    new PostgresRegistryConfigRepository(
      pool,
    );
  const configFile =
    await configs.get(REGISTRY_ID);

  if (!configFile) {
    throw new Error(
      "Open Legal Interpretations must be installed before source refresh can run.",
    );
  }

  const compiled =
    compileRegistryConfig(configFile);
  const profileSource =
    await readFile(
      PROFILE_PATH,
      "utf8",
    );
  const profile =
    parseIngestionProfile(
      profileSource,
      compiled,
    );
  const ingestion =
    new PostgresIngestionService(pool);

  return async (
    claim: SourceRefreshClaim,
  ) => {
    const adapter =
      adapters.get(
        claim.job.adapterId,
      );

    if (!adapter) {
      throw new Error(
        "No source adapter is registered for " +
          claim.job.adapterId +
          ".",
      );
    }

    const adapterRun =
      await runSourceAdapter(
        adapter,
        claim.job.adapterOptions,
      );
    const ingestionResult =
      await ingestion.run({
        registryId:
          claim.job.registryId,
        profile,
        format: "ndjson",
        input:
          adapterRun.output,
        sourceLabel:
          claim.job.label,
        sourceUri:
          adapterRun.manifest
            .sourcePages[0] ??
          adapter.defaultStartUrls[0],
        actorId:
          "system:source-refresh-worker",
        reason:
          "Scheduled source refresh " +
          claim.job.id +
          ".",
        metadata: {
          sourceRefreshJobId:
            claim.job.id,
          sourceRefreshRunId:
            claim.run.id,
          adapterId:
            claim.job.adapterId,
          adapterOutputSha256:
            adapterRun.manifest
              .outputSha256,
          adapterWarningCount:
            adapterRun.manifest
              .warnings.length,
        },
      });

    return {
      manifest:
        adapterRun.manifest,
      ingestionRunId:
        ingestionResult.run.id,
      ingestionStatus:
        ingestionResult.run.status,
      ingestionFailedItems:
        ingestionResult.run.failedItems,
      metadata: {
        ingestionCreatedItems:
          ingestionResult.run
            .createdItems,
        ingestionUpdatedItems:
          ingestionResult.run
            .updatedItems,
        ingestionUnchangedItems:
          ingestionResult.run
            .unchangedItems,
      },
    };
  };
}

async function main(): Promise<void> {
  const args =
    process.argv.slice(2);
  const command =
    args.find(
      (arg) =>
        !arg.startsWith("--"),
    ) ?? "run";
  const force =
    args.includes("--force");
  const pool =
    createDatabasePool({
      applicationName:
        "open-legal-interpretations-source-refresh",
    });

  try {
    await runMigrations(pool);

    const service =
      new PostgresSourceRefreshService(
        pool,
      );

    await service.syncDefinitions(
      REGISTRY_ID,
      openLegalInterpretationsRefreshJobs,
    );

    if (command === "sync") {
      console.log(
        JSON.stringify(
          {
            command:
              "source-refresh-sync",
            registryId:
              REGISTRY_ID,
            jobs:
              await service.listJobs(
                REGISTRY_ID,
              ),
          },
          null,
          2,
        ),
      );
      return;
    }

    if (command === "status") {
      console.log(
        JSON.stringify(
          {
            command:
              "source-refresh-status",
            registryId:
              REGISTRY_ID,
            health:
              await service.listHealth(
                REGISTRY_ID,
              ),
            recentRuns:
              await service.listRuns(
                REGISTRY_ID,
                {
                  limit: 20,
                },
              ),
          },
          null,
          2,
        ),
      );
      return;
    }

    if (command !== "run") {
      throw new Error(
        "Usage: [run|sync|status] [--force]",
      );
    }

    if (force) {
      const jobs =
        await service.listJobs(
          REGISTRY_ID,
        );

      for (const job of jobs) {
        if (!job.enabled) continue;

        try {
          await service.queueNow(
            REGISTRY_ID,
            job.id,
          );
        } catch (error) {
          if (
            !(
              error instanceof Error &&
              /already running/i.test(
                error.message,
              )
            )
          ) {
            throw error;
          }
        }
      }
    }

    const executor =
      await makeExecutor(pool);
    const result =
      await service.runDue({
        registryId:
          REGISTRY_ID,
        limit: 10,
        leaseSeconds: 1800,
        executor,
      });

    console.log(
      JSON.stringify(
        {
          command:
            "source-refresh-run",
          registryId:
            REGISTRY_ID,
          ...result,
        },
        null,
        2,
      ),
    );

    if (result.failed > 0) {
      process.exitCode = 2;
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message
      : error,
  );
  process.exitCode = 1;
});
