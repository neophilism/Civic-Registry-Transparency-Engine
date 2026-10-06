import type {
  JsonFieldValue,
  Visibility,
} from "./domain.ts";

export const NOTIFICATION_CHANNELS = [
  "email",
  "webhook",
  "internal",
] as const;

export type NotificationChannel =
  (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_EVENT_TYPES = [
  "record.published",
  "record.changed",
  "record.matching_created",
  "deadline.approaching",
  "deadline.missed",
  "document.added",
] as const;

export type NotificationEventType =
  (typeof NOTIFICATION_EVENT_TYPES)[number];

export type NotificationScope =
  | "public"
  | "internal";

export interface EmailNotificationTarget {
  email: string;
}

export interface WebhookNotificationTarget {
  url: string;
  secret?: string;
}

export interface InternalNotificationTarget {
  recipientId: string;
}

export type NotificationTarget =
  | EmailNotificationTarget
  | WebhookNotificationTarget
  | InternalNotificationTarget;

export interface NotificationSubscriptionFilters {
  recordTypeIds?: string[];
  recordIds?: string[];
  statusIds?: string[];
  tags?: string[];
}

export interface NotificationSubscription {
  id: string;
  registryId: string;
  scope: NotificationScope;
  channel: NotificationChannel;
  target: NotificationTarget;
  eventTypes: NotificationEventType[];
  filters: NotificationSubscriptionFilters;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  actorId?: string;
}

export interface NotificationEvent {
  id: string;
  registryId: string;
  eventType: NotificationEventType;
  subjectType: "record" | "document" | "deadline";
  subjectId: string;
  visibility: Visibility;
  occurredAt: string;
  dedupeKey: string;
  payload: Record<string, JsonFieldValue>;
}

export interface NotificationDelivery {
  id: string;
  registryId: string;
  eventId: string;
  subscriptionId: string;
  channel: NotificationChannel;
  target: NotificationTarget;
  status: "pending" | "sent" | "failed";
  attempts: number;
  nextAttemptAt?: string;
  lastAttemptAt?: string;
  lastError?: string;
  createdAt: string;
  sentAt?: string;
}

export interface InternalNotification {
  id: string;
  registryId: string;
  deliveryId: string;
  eventId: string;
  recipientId: string;
  title: string;
  body: string;
  createdAt: string;
  readAt?: string;
}

function intersects(
  expected: string[] | undefined,
  actual: string[] | undefined,
): boolean {
  if (!expected || expected.length === 0) return true;
  if (!actual || actual.length === 0) return false;

  const actualSet = new Set(actual);
  return expected.some((value) =>
    actualSet.has(value),
  );
}

function stringPayload(
  payload: NotificationEvent["payload"],
  key: string,
): string | undefined {
  const value = payload[key];
  return typeof value === "string"
    ? value
    : undefined;
}

function stringListPayload(
  payload: NotificationEvent["payload"],
  key: string,
): string[] | undefined {
  const value = payload[key];

  if (
    Array.isArray(value) &&
    value.every(
      (entry) => typeof entry === "string",
    )
  ) {
    return value;
  }

  return undefined;
}

export function notificationMatchesSubscription(
  event: NotificationEvent,
  subscription: NotificationSubscription,
): boolean {
  if (!subscription.enabled) return false;

  if (
    subscription.registryId !== event.registryId ||
    !subscription.eventTypes.includes(
      event.eventType,
    )
  ) {
    return false;
  }

  if (
    subscription.scope === "public" &&
    event.visibility !== "public"
  ) {
    return false;
  }

  const filters = subscription.filters;

  const recordId =
    stringPayload(event.payload, "recordId") ??
    (event.subjectType === "record"
      ? event.subjectId
      : undefined);

  if (
    filters.recordIds?.length &&
    !filters.recordIds.includes(recordId ?? "")
  ) {
    return false;
  }

  if (
    filters.recordTypeIds?.length &&
    !filters.recordTypeIds.includes(
      stringPayload(
        event.payload,
        "recordTypeId",
      ) ?? "",
    )
  ) {
    return false;
  }

  if (
    filters.statusIds?.length &&
    !filters.statusIds.includes(
      stringPayload(event.payload, "status") ??
        "",
    )
  ) {
    return false;
  }

  if (
    !intersects(
      filters.tags,
      stringListPayload(event.payload, "tags"),
    )
  ) {
    return false;
  }

  return true;
}

export function notificationEventTitle(
  eventType: NotificationEventType,
): string {
  switch (eventType) {
    case "record.published":
      return "Record published";
    case "record.changed":
      return "Record changed";
    case "record.matching_created":
      return "New matching record";
    case "deadline.approaching":
      return "Deadline approaching";
    case "deadline.missed":
      return "Deadline missed";
    case "document.added":
      return "Document added";
  }
}
