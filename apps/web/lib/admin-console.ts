import {
  compileRegistryConfig,
  validateRegistryConfig,
  type CompiledRegistryConfig,
  type RegistryConfigFile,
} from "@civic-registry/config";
import type {
  RegistryRecord,
} from "@civic-registry/core";
import type {
  AdminRegistrySummary,
} from "@civic-registry/database";

import {
  adminRecordTitle,
} from "./admin-record";
import { getRepositories } from "./database";

export interface AdminRegistryView {
  configFile: RegistryConfigFile;
  config: CompiledRegistryConfig;
  summary: AdminRegistrySummary;
}

export async function listAdminRegistries(): Promise<
  AdminRegistryView[]
> {
  const repositories = getRepositories();
  const configFiles =
    await repositories.configs.list();

  return Promise.all(
    configFiles.map(async (configFile) => ({
      configFile,
      config: compileRegistryConfig(configFile),
      summary:
        await repositories.admin.getRegistrySummary(
          configFile.registry.id,
        ),
    })),
  );
}

export async function getAdminRegistry(
  registryId: string,
): Promise<AdminRegistryView | null> {
  const repositories = getRepositories();
  const configFile =
    await repositories.configs.get(registryId);

  if (!configFile) return null;

  return {
    configFile,
    config: compileRegistryConfig(configFile),
    summary:
      await repositories.admin.getRegistrySummary(
        registryId,
      ),
  };
}

export function getAdminRecordTitle(
  config: CompiledRegistryConfig,
  record: RegistryRecord,
): string {
  return adminRecordTitle(
    config.getRecordType(record.recordTypeId),
    record,
  );
}

export function getAdminStatusLabel(
  config: CompiledRegistryConfig,
  statusId: string,
): string {
  return (
    config.publicationLifecycle?.statusesById.get(
      statusId,
    )?.label ?? statusId
  );
}

export function getAdminDeadlineLabel(
  config: CompiledRegistryConfig,
  deadlineTypeId: string,
): string {
  return (
    config.deadlines?.definitionsById.get(
      deadlineTypeId,
    )?.label ?? deadlineTypeId
  );
}

export function validateInstalledConfig(
  configFile: RegistryConfigFile,
) {
  return validateRegistryConfig(configFile);
}
