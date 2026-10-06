import {
  mkdir,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
} from "node:path";

import {
  runSourceAdapter,
  type SourceAdapter,
} from "@civic-registry/source-adapters";

import {
  dojOlcAdapter,
  ogeLegalAdvisoriesAdapter,
} from "./index.ts";

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

function positiveInteger(
  value: string | undefined,
  label: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const number = Number(value);

  if (
    !Number.isInteger(number) ||
    number < 1
  ) {
    throw new Error(
      `${label} must be a positive integer.`,
    );
  }

  return number;
}

function optionValues(
  args: string[],
  prefix: string,
): string[] {
  return args
    .filter((arg) =>
      arg.startsWith(prefix),
    )
    .map((arg) =>
      arg.slice(prefix.length),
    )
    .filter(Boolean);
}

async function main(): Promise<void> {
  const [
    adapterId,
    outputPath,
    ...args
  ] = process.argv.slice(2);

  if (!adapterId || !outputPath) {
    throw new Error(
      "Usage: <doj-olc|oge-legal-advisories> <output.ndjson> [--max-items=N] [--max-pages=N] [--start-url=https://...] [--manifest=path.json]",
    );
  }

  const adapter =
    adapters.get(adapterId);

  if (!adapter) {
    throw new Error(
      `Unknown source adapter: ${adapterId}.`,
    );
  }

  const maxItemsArg = args.find(
    (arg) =>
      arg.startsWith(
        "--max-items=",
      ),
  );
  const maxPagesArg = args.find(
    (arg) =>
      arg.startsWith(
        "--max-pages=",
      ),
  );
  const manifestArg = args.find(
    (arg) =>
      arg.startsWith(
        "--manifest=",
      ),
  );
  const startUrls = optionValues(
    args,
    "--start-url=",
  );
  const maxItems = positiveInteger(
    maxItemsArg?.slice(
      "--max-items=".length,
    ),
    "max-items",
  );
  const maxPages = positiveInteger(
    maxPagesArg?.slice(
      "--max-pages=".length,
    ),
    "max-pages",
  );
  const manifestPath =
    manifestArg?.slice(
      "--manifest=".length,
    ) ||
    outputPath +
      ".manifest.json";

  const result =
    await runSourceAdapter(
      adapter,
      {
        ...(startUrls.length > 0
          ? { startUrls }
          : {}),
        ...(maxItems
          ? { maxItems }
          : {}),
        ...(maxPages
          ? { maxPages }
          : {}),
      },
    );

  await Promise.all([
    mkdir(
      dirname(outputPath),
      {
        recursive: true,
      },
    ),
    mkdir(
      dirname(manifestPath),
      {
        recursive: true,
      },
    ),
  ]);

  await Promise.all([
    writeFile(
      outputPath,
      result.output,
      "utf8",
    ),
    writeFile(
      manifestPath,
      JSON.stringify(
        result.manifest,
        null,
        2,
      ) + "\n",
      "utf8",
    ),
  ]);

  console.log(
    JSON.stringify(
      {
        command:
          "open-legal-interpretations-source-adapter",
        adapterId,
        outputPath,
        manifestPath,
        rowCount:
          result.manifest.rowCount,
        outputSha256:
          result.manifest
            .outputSha256,
        warnings:
          result.manifest.warnings,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message
      : error,
  );
  process.exitCode = 1;
});
