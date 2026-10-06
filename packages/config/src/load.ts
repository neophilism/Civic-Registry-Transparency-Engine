import { parse } from "yaml";

import { compileRegistryConfig } from "./compile.ts";
import {
  assertValidRegistryConfig,
  RegistryConfigError,
} from "./validation.ts";
import type {
  CompiledRegistryConfig,
  RegistryConfigFile,
} from "./types.ts";

export type RegistryConfigFormat = "yaml" | "json" | "auto";

export interface LoadRegistryConfigOptions {
  format?: RegistryConfigFormat;
  sourceName?: string;
}

function parseJson(source: string, sourceName: string): unknown {
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new RegistryConfigError(
      `Could not parse ${sourceName} as JSON.`,
      [
        {
          path: "$",
          code: "json_parse_error",
          message:
            error instanceof Error ? error.message : "Invalid JSON.",
        },
      ],
    );
  }
}

function parseYaml(source: string, sourceName: string): unknown {
  try {
    return parse(source);
  } catch (error) {
    throw new RegistryConfigError(
      `Could not parse ${sourceName} as YAML.`,
      [
        {
          path: "$",
          code: "yaml_parse_error",
          message:
            error instanceof Error ? error.message : "Invalid YAML.",
        },
      ],
    );
  }
}

export function parseRegistryConfig(
  source: string,
  options: LoadRegistryConfigOptions = {},
): RegistryConfigFile {
  const sourceName = options.sourceName ?? "registry configuration";
  const format = options.format ?? "auto";
  const trimmed = source.trimStart();

  const parsed =
    format === "json" ||
    (format === "auto" &&
      (trimmed.startsWith("{") || trimmed.startsWith("[")))
      ? parseJson(source, sourceName)
      : parseYaml(source, sourceName);

  assertValidRegistryConfig(parsed);
  return parsed;
}

export function loadRegistryConfig(
  source: string,
  options: LoadRegistryConfigOptions = {},
): CompiledRegistryConfig {
  return compileRegistryConfig(
    parseRegistryConfig(source, options),
  );
}
