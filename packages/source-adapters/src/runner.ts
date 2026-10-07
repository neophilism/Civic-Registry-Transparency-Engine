import {
  createHash,
} from "node:crypto";

import {
  createPublicSourceClient,
} from "./fetch.ts";
import type {
  SourceAdapter,
  SourceAdapterRunManifest,
  SourceAdapterRunOptions,
  SourceAdapterRow,
} from "./types.ts";

function stableObject(
  value: unknown,
): unknown {
  if (Array.isArray(value)) {
    return value.map(stableObject);
  }

  if (
    value &&
    typeof value === "object"
  ) {
    return Object.fromEntries(
      Object.entries(
        value as Record<string, unknown>,
      )
        .filter(
          ([, entry]) =>
            entry !== undefined,
        )
        .sort(([left], [right]) =>
          left.localeCompare(right),
        )
        .map(([key, entry]) => [
          key,
          stableObject(entry),
        ]),
    );
  }

  return value;
}

export function serializeAdapterRows(
  rows: SourceAdapterRow[],
): string {
  return (
    rows
      .map((row) =>
        JSON.stringify(stableObject(row)),
      )
      .join("\n") +
    (rows.length > 0 ? "\n" : "")
  );
}

export function sha256String(
  value: string,
): string {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

export async function runSourceAdapter(
  adapter: SourceAdapter,
  options: SourceAdapterRunOptions = {},
): Promise<{
  rows: SourceAdapterRow[];
  output: string;
  manifest: SourceAdapterRunManifest;
}> {
  const retrievedAt =
    options.retrievedAt ??
    new Date().toISOString();
  const client =
    createPublicSourceClient();
  const collection =
    await adapter.collect(
      client,
      {
        ...options,
        retrievedAt,
      },
    );

  const deduped = new Map<
    string,
    SourceAdapterRow
  >();

  for (const row of collection.rows) {
    const key =
      row.canonical_url.trim().toLowerCase();

    if (!deduped.has(key)) {
      deduped.set(key, row);
    }
  }

  const rows = [
    ...deduped.values(),
  ].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const output =
    serializeAdapterRows(rows);

  return {
    rows,
    output,
    manifest: {
      formatVersion: 1,
      adapterId: adapter.id,
      adapterLabel: adapter.label,
      retrievedAt,
      rowCount: rows.length,
      sourcePages: [
        ...new Set(
          collection.sourcePages,
        ),
      ].sort(),
      warnings:
        collection.warnings,
      outputSha256:
        sha256String(output),
    },
  };
}
