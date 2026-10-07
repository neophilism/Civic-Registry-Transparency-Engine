"use server";

import { randomUUID } from "node:crypto";

import { compileRegistryConfig } from "@civic-registry/config";
import type {
  ExternalIdentifier,
  NotificationChannel,
  NotificationEventType,
  NotificationScope,
  NotificationTarget,
  RegistryRecord,
  Source,
  SourceType,
  Visibility,
} from "@civic-registry/core";
import {
  PostgresNotificationService,
  PostgresPublicationLifecycleService,
} from "@civic-registry/database";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  clearAdminSession,
  establishAdminSession,
  requireAdminSession,
  verifyAdminAccessToken,
} from "../../lib/admin-auth";
import { parseAdminRecordFields } from "../../lib/admin-record";
import {
  getDatabasePool,
  getRepositories,
} from "../../lib/database";

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function csv(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
}

function safeReturnTo(value: string, fallback: string): string {
  return value.startsWith("/admin") ? value : fallback;
}

function destination(
  path: string,
  kind: "notice" | "error",
  message: string,
): string {
  const separator = path.includes("?") ? "&" : "?";
  return (
    path +
    separator +
    kind +
    "=" +
    encodeURIComponent(message)
  );
}

function parseVisibility(value: string): Visibility {
  if (
    value === "public" ||
    value === "restricted" ||
    value === "private" ||
    value === "embargoed"
  ) {
    return value;
  }

  return "private";
}

function parseExternalIdentifiers(
  value: string,
): ExternalIdentifier[] {
  if (!value.trim()) return [];

  const parsed = JSON.parse(value) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error(
      "External identifiers must be a JSON array.",
    );
  }

  return parsed.map((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      !("scheme" in entry) ||
      !("value" in entry)
    ) {
      throw new Error(
        "Each external identifier requires scheme and value.",
      );
    }

    const candidate = entry as {
      scheme: unknown;
      value: unknown;
      url?: unknown;
    };

    if (
      typeof candidate.scheme !== "string" ||
      typeof candidate.value !== "string" ||
      (candidate.url !== undefined &&
        typeof candidate.url !== "string")
    ) {
      throw new Error(
        "External identifier fields must be strings.",
      );
    }

    return {
      scheme: candidate.scheme,
      value: candidate.value,
      url: candidate.url,
    };
  });
}

function errorMessage(
  error: unknown,
  fallback: string,
): string {
  return error instanceof Error
    ? error.message
    : fallback;
}

export async function signInAdmin(
  formData: FormData,
): Promise<void> {
  const token = text(formData, "token");
  const actorId = text(formData, "actorId");
  const roles = csv(text(formData, "roles"));

  if (!verifyAdminAccessToken(token)) {
    redirect(
      destination(
        "/admin/sign-in",
        "error",
        "Administrator access token is invalid.",
      ),
    );
  }

  if (!actorId) {
    redirect(
      destination(
        "/admin/sign-in",
        "error",
        "Actor ID is required.",
      ),
    );
  }

  await establishAdminSession(actorId, roles);
  redirect("/admin");
}

export async function signOutAdmin(): Promise<void> {
  await clearAdminSession();
  redirect("/admin/sign-in");
}

export async function createAdminRecord(
  formData: FormData,
): Promise<void> {
  const session = await requireAdminSession();
  const registryId = text(formData, "registryId");
  const recordTypeId = text(formData, "recordTypeId");
  const returnTo = safeReturnTo(
    text(formData, "returnTo"),
    "/admin/registries/" +
      encodeURIComponent(registryId),
  );
  let failure: string | undefined;

  try {
    const repositories = getRepositories();
    const configFile =
      await repositories.configs.get(registryId);

    if (!configFile) {
      throw new Error(
        "Registry configuration was not found.",
      );
    }

    const config = compileRegistryConfig(configFile);
    const recordType =
      config.getRecordType(recordTypeId);
    const now = new Date().toISOString();
    const reason =
      text(formData, "reason") ||
      "Administrator console record creation.";
    const record: RegistryRecord = {
      id: text(formData, "recordId") || randomUUID(),
      registryId,
      recordTypeId,
      fields: parseAdminRecordFields(
        recordType,
        formData,
      ),
      status:
        config.publicationLifecycle?.definition
          .initialStatusId ?? "active",
      visibility: parseVisibility(
        text(formData, "visibility"),
      ),
      externalIdentifiers:
        parseExternalIdentifiers(
          text(formData, "externalIdentifiers"),
        ),
      tags: csv(text(formData, "tags")),
      createdAt: now,
      updatedAt: now,
    };

    await repositories.records.create(record, {
      context: {
        actorId: session.actorId,
        reason,
      },
    });
  } catch (error) {
    failure = errorMessage(
      error,
      "Record could not be created.",
    );
  }

  if (failure) {
    redirect(destination(returnTo, "error", failure));
  }

  revalidatePath(returnTo);
  redirect(
    destination(returnTo, "notice", "Record created."),
  );
}

export async function updateAdminRecord(
  formData: FormData,
): Promise<void> {
  const session = await requireAdminSession();
  const registryId = text(formData, "registryId");
  const recordId = text(formData, "recordId");
  const returnTo = safeReturnTo(
    text(formData, "returnTo"),
    "/admin/registries/" +
      encodeURIComponent(registryId) +
      "/records/" +
      encodeURIComponent(recordId),
  );
  let failure: string | undefined;

  try {
    const repositories = getRepositories();
    const [configFile, existing] =
      await Promise.all([
        repositories.configs.get(registryId),
        repositories.records.get(
          registryId,
          recordId,
        ),
      ]);

    if (!configFile || !existing) {
      throw new Error(
        "Registry or record was not found.",
      );
    }

    const config = compileRegistryConfig(configFile);
    const recordType =
      config.getRecordType(existing.recordTypeId);
    const reason =
      text(formData, "reason") ||
      "Administrator console record update.";
    const updated: RegistryRecord = {
      ...existing,
      fields: parseAdminRecordFields(
        recordType,
        formData,
      ),
      visibility: parseVisibility(
        text(formData, "visibility"),
      ),
      externalIdentifiers:
        parseExternalIdentifiers(
          text(formData, "externalIdentifiers"),
        ),
      tags: csv(text(formData, "tags")),
      updatedAt: new Date().toISOString(),
    };

    await repositories.records.update(updated, {
      context: {
        actorId: session.actorId,
        reason,
      },
    });
  } catch (error) {
    failure = errorMessage(
      error,
      "Record could not be updated.",
    );
  }

  if (failure) {
    redirect(destination(returnTo, "error", failure));
  }

  revalidatePath(returnTo);
  redirect(
    destination(returnTo, "notice", "Record updated."),
  );
}

export async function requestAdminTransition(
  formData: FormData,
): Promise<void> {
  const session = await requireAdminSession();
  const registryId = text(formData, "registryId");
  const returnTo = safeReturnTo(
    text(formData, "returnTo"),
    "/admin/registries/" +
      encodeURIComponent(registryId),
  );
  let failure: string | undefined;
  let notice = "Lifecycle transition completed.";

  try {
    const service =
      new PostgresPublicationLifecycleService(
        getDatabasePool(),
        getRepositories().deadlines,
      );
    const result =
      await service.requestTransition({
        registryId,
        recordId: text(formData, "recordId"),
        toStatusId: text(formData, "toStatusId"),
        context: {
          actorId: session.actorId,
          roles: session.roles,
          reason:
            text(formData, "reason") ||
            "Administrator console lifecycle action.",
        },
      });

    if (result.kind === "pending_approval") {
      notice =
        "Lifecycle transition submitted for approval.";
    }
  } catch (error) {
    failure = errorMessage(
      error,
      "Lifecycle transition failed.",
    );
  }

  if (failure) {
    redirect(destination(returnTo, "error", failure));
  }

  revalidatePath(returnTo);
  redirect(destination(returnTo, "notice", notice));
}

export async function decideAdminTransition(
  formData: FormData,
): Promise<void> {
  const session = await requireAdminSession();
  const registryId = text(formData, "registryId");
  const returnTo = safeReturnTo(
    text(formData, "returnTo"),
    "/admin/registries/" +
      encodeURIComponent(registryId),
  );
  let failure: string | undefined;

  try {
    const service =
      new PostgresPublicationLifecycleService(
        getDatabasePool(),
        getRepositories().deadlines,
      );
    await service.decideTransition({
      registryId,
      requestId: text(formData, "requestId"),
      decision:
        text(formData, "decision") === "rejected"
          ? "rejected"
          : "approved",
      actorId: session.actorId,
      actorRoles: session.roles,
      note: text(formData, "note") || undefined,
    });
  } catch (error) {
    failure = errorMessage(
      error,
      "Approval decision failed.",
    );
  }

  if (failure) {
    redirect(destination(returnTo, "error", failure));
  }

  revalidatePath(returnTo);
  redirect(
    destination(
      returnTo,
      "notice",
      "Approval decision recorded.",
    ),
  );
}

export async function transitionAdminDeadline(
  formData: FormData,
): Promise<void> {
  const session = await requireAdminSession();
  const registryId = text(formData, "registryId");
  const deadlineId = text(formData, "deadlineId");
  const action = text(formData, "deadlineAction");
  const returnTo = safeReturnTo(
    text(formData, "returnTo"),
    "/admin/registries/" +
      encodeURIComponent(registryId),
  );
  let failure: string | undefined;

  try {
    const service = getRepositories().deadlines;
    const input = {
      context: {
        actorId: session.actorId,
        reason:
          text(formData, "reason") ||
          "Administrator console deadline action.",
      },
    };

    if (action === "pause") {
      await service.pause(
        registryId,
        deadlineId,
        input,
      );
    } else if (action === "resume") {
      await service.resume(
        registryId,
        deadlineId,
        input,
      );
    } else if (action === "complete") {
      await service.complete(
        registryId,
        deadlineId,
        input,
      );
    } else if (action === "cancel") {
      await service.cancel(
        registryId,
        deadlineId,
        input,
      );
    } else {
      throw new Error(
        "Unsupported deadline action.",
      );
    }
  } catch (error) {
    failure = errorMessage(
      error,
      "Deadline action failed.",
    );
  }

  if (failure) {
    redirect(destination(returnTo, "error", failure));
  }

  revalidatePath(returnTo);
  redirect(
    destination(returnTo, "notice", "Deadline updated."),
  );
}

export async function createAdminSource(
  formData: FormData,
): Promise<void> {
  await requireAdminSession();
  const registryId = text(formData, "registryId");
  const returnTo = safeReturnTo(
    text(formData, "returnTo"),
    "/admin/registries/" +
      encodeURIComponent(registryId),
  );
  let failure: string | undefined;

  try {
    const now = new Date().toISOString();
    const source: Source = {
      id: text(formData, "sourceId") || randomUUID(),
      registryId,
      title: text(formData, "title"),
      sourceType:
        (text(formData, "sourceType") ||
          "other") as SourceType,
      visibility: parseVisibility(
        text(formData, "visibility"),
      ),
      canonicalUrl:
        text(formData, "canonicalUrl") || undefined,
      description:
        text(formData, "description") || undefined,
      retrievedAt: now,
      createdAt: now,
    };

    await getRepositories().sources.create(source);
  } catch (error) {
    failure = errorMessage(
      error,
      "Source could not be created.",
    );
  }

  if (failure) {
    redirect(destination(returnTo, "error", failure));
  }

  revalidatePath(returnTo);
  redirect(
    destination(returnTo, "notice", "Source created."),
  );
}

export async function reconcileAdminDeadlines(
  formData: FormData,
): Promise<void> {
  await requireAdminSession();
  const registryId = text(formData, "registryId");
  const returnTo = safeReturnTo(
    text(formData, "returnTo"),
    "/admin/registries/" +
      encodeURIComponent(registryId),
  );
  let failure: string | undefined;
  let notice = "Deadline reconciliation completed.";

  try {
    const result =
      await getRepositories().deadlines.reconcileRegistry(
        registryId,
        { limit: 500 },
      );
    notice =
      `Reconciled ${result.records} records; ${result.created} deadlines created and ${result.updated} updated.`;
  } catch (error) {
    failure = errorMessage(
      error,
      "Deadline reconciliation failed.",
    );
  }

  if (failure) {
    redirect(destination(returnTo, "error", failure));
  }

  revalidatePath(returnTo);
  redirect(destination(returnTo, "notice", notice));
}


export async function createAdminNotificationSubscription(
  formData: FormData,
): Promise<void> {
  const session = await requireAdminSession();
  const registryId = text(formData, "registryId");
  const returnTo = safeReturnTo(
    text(formData, "returnTo"),
    "/admin/registries/" +
      encodeURIComponent(registryId) +
      "/notifications",
  );
  let failure: string | undefined;

  try {
    const channel =
      text(formData, "channel") as NotificationChannel;
    const scope =
      text(formData, "scope") as NotificationScope;
    let target: NotificationTarget;

    if (channel === "email") {
      target = {
        email: text(formData, "target"),
      };
    } else if (channel === "webhook") {
      target = {
        url: text(formData, "target"),
        secret: text(formData, "webhookSecret"),
      };
    } else {
      target = {
        recipientId: text(formData, "target"),
      };
    }

    const service = new PostgresNotificationService(
      getDatabasePool(),
    );

    await service.createSubscription({
      registryId,
      scope,
      channel,
      target,
      eventTypes: csv(
        text(formData, "eventTypes"),
      ) as NotificationEventType[],
      filters: {
        recordTypeIds: csv(
          text(formData, "recordTypeIds"),
        ),
        recordIds: csv(
          text(formData, "recordIds"),
        ),
        statusIds: csv(
          text(formData, "statusIds"),
        ),
        tags: csv(text(formData, "tags")),
      },
      actorId: session.actorId,
    });
  } catch (error) {
    failure = errorMessage(
      error,
      "Notification subscription could not be created.",
    );
  }

  if (failure) {
    redirect(destination(returnTo, "error", failure));
  }

  revalidatePath(returnTo);
  redirect(
    destination(
      returnTo,
      "notice",
      "Notification subscription created.",
    ),
  );
}

export async function setAdminNotificationSubscriptionEnabled(
  formData: FormData,
): Promise<void> {
  const session = await requireAdminSession();
  const registryId = text(formData, "registryId");
  const subscriptionId =
    text(formData, "subscriptionId");
  const enabled =
    text(formData, "enabled") === "true";
  const returnTo = safeReturnTo(
    text(formData, "returnTo"),
    "/admin/registries/" +
      encodeURIComponent(registryId) +
      "/notifications",
  );
  let failure: string | undefined;

  try {
    const service = new PostgresNotificationService(
      getDatabasePool(),
    );
    await service.setSubscriptionEnabled(
      registryId,
      subscriptionId,
      enabled,
      session.actorId,
    );
  } catch (error) {
    failure = errorMessage(
      error,
      "Notification subscription could not be updated.",
    );
  }

  if (failure) {
    redirect(destination(returnTo, "error", failure));
  }

  revalidatePath(returnTo);
  redirect(
    destination(
      returnTo,
      "notice",
      enabled
        ? "Notification subscription enabled."
        : "Notification subscription disabled.",
    ),
  );
}

export async function deleteAdminNotificationSubscription(
  formData: FormData,
): Promise<void> {
  const session = await requireAdminSession();
  const registryId = text(formData, "registryId");
  const subscriptionId =
    text(formData, "subscriptionId");
  const returnTo = safeReturnTo(
    text(formData, "returnTo"),
    "/admin/registries/" +
      encodeURIComponent(registryId) +
      "/notifications",
  );
  let failure: string | undefined;

  try {
    const service = new PostgresNotificationService(
      getDatabasePool(),
    );
    const deleted =
      await service.deleteSubscription(
        registryId,
        subscriptionId,
        session.actorId,
      );

    if (!deleted) {
      throw new Error(
        "Notification subscription does not exist.",
      );
    }
  } catch (error) {
    failure = errorMessage(
      error,
      "Notification subscription could not be deleted.",
    );
  }

  if (failure) {
    redirect(destination(returnTo, "error", failure));
  }

  revalidatePath(returnTo);
  redirect(
    destination(
      returnTo,
      "notice",
      "Notification subscription deleted.",
    ),
  );
}

export async function runAdminNotifications(
  formData: FormData,
): Promise<void> {
  await requireAdminSession();
  const registryId = text(formData, "registryId");
  const returnTo = safeReturnTo(
    text(formData, "returnTo"),
    "/admin/registries/" +
      encodeURIComponent(registryId) +
      "/notifications",
  );
  let failure: string | undefined;
  let notice = "Notification run completed.";

  try {
    const service = new PostgresNotificationService(
      getDatabasePool(),
    );
    const result = await service.run(registryId);

    notice =
      `Collected ${result.collected} events, created ${result.materialized} deliveries, sent ${result.dispatched}, suppressed ${result.suppressed}, and recorded ${result.failed} delivery failures.`;
  } catch (error) {
    failure = errorMessage(
      error,
      "Notification run failed.",
    );
  }

  if (failure) {
    redirect(destination(returnTo, "error", failure));
  }

  revalidatePath(returnTo);
  redirect(destination(returnTo, "notice", notice));
}

export async function markAdminNotificationRead(
  formData: FormData,
): Promise<void> {
  const session = await requireAdminSession();
  const registryId = text(formData, "registryId");
  const notificationId =
    text(formData, "notificationId");
  const returnTo = safeReturnTo(
    text(formData, "returnTo"),
    "/admin/registries/" +
      encodeURIComponent(registryId) +
      "/notifications",
  );

  const service = new PostgresNotificationService(
    getDatabasePool(),
  );
  await service.markInternalNotificationRead(
    registryId,
    notificationId,
    session.actorId,
  );

  revalidatePath(returnTo);
  redirect(returnTo);
}


export async function setAdminSourceRefreshEnabled(
  formData: FormData,
): Promise<void> {
  await requireAdminSession();
  const registryId = text(
    formData,
    "registryId",
  );
  const jobId = text(
    formData,
    "jobId",
  );
  const enabled =
    text(formData, "enabled") === "true";
  const returnTo = safeReturnTo(
    text(formData, "returnTo"),
    "/admin/registries/" +
      encodeURIComponent(registryId) +
      "/source-refresh",
  );
  let failure: string | undefined;

  try {
    await getRepositories().sourceRefresh.setEnabled(
      registryId,
      jobId,
      enabled,
    );
  } catch (error) {
    failure = errorMessage(
      error,
      "Source refresh job could not be updated.",
    );
  }

  if (failure) {
    redirect(
      destination(
        returnTo,
        "error",
        failure,
      ),
    );
  }

  revalidatePath(returnTo);
  redirect(
    destination(
      returnTo,
      "notice",
      enabled
        ? "Source refresh job enabled."
        : "Source refresh job disabled.",
    ),
  );
}

export async function queueAdminSourceRefreshNow(
  formData: FormData,
): Promise<void> {
  await requireAdminSession();
  const registryId = text(
    formData,
    "registryId",
  );
  const jobId = text(
    formData,
    "jobId",
  );
  const returnTo = safeReturnTo(
    text(formData, "returnTo"),
    "/admin/registries/" +
      encodeURIComponent(registryId) +
      "/source-refresh",
  );
  let failure: string | undefined;

  try {
    await getRepositories().sourceRefresh.queueNow(
      registryId,
      jobId,
    );
  } catch (error) {
    failure = errorMessage(
      error,
      "Source refresh job could not be queued.",
    );
  }

  if (failure) {
    redirect(
      destination(
        returnTo,
        "error",
        failure,
      ),
    );
  }

  revalidatePath(returnTo);
  redirect(
    destination(
      returnTo,
      "notice",
      "Source refresh job queued. The worker will claim it on its next poll.",
    ),
  );
}


export async function reviewAdminRelationshipCandidate(
  formData: FormData,
): Promise<void> {
  const session = await requireAdminSession();
  const registryId = text(
    formData,
    "registryId",
  );
  const candidateId = text(
    formData,
    "candidateId",
  );
  const decision =
    text(formData, "decision") ===
      "rejected"
      ? "rejected"
      : "approved";
  const returnTo = safeReturnTo(
    text(formData, "returnTo"),
    "/admin/registries/" +
      encodeURIComponent(registryId) +
      "/relationship-candidates",
  );
  let failure: string | undefined;

  try {
    await getRepositories()
      .relationshipCandidates.review({
        registryId,
        candidateId,
        decision,
        actorId: session.actorId,
        note:
          text(formData, "note") ||
          undefined,
        reason:
          "Administrator " +
          decision +
          " relationship candidate " +
          candidateId +
          ".",
      });
  } catch (error) {
    failure = errorMessage(
      error,
      "Relationship candidate review failed.",
    );
  }

  if (failure) {
    redirect(
      destination(
        returnTo,
        "error",
        failure,
      ),
    );
  }

  revalidatePath(returnTo);
  revalidatePath(
    "/admin/registries/" +
      encodeURIComponent(registryId),
  );
  redirect(
    destination(
      returnTo,
      "notice",
      decision === "approved"
        ? "Relationship candidate approved and materialized."
        : "Relationship candidate rejected.",
    ),
  );
}
