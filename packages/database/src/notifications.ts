import {
  createHmac,
  randomUUID,
} from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import {
  compileRegistryConfig,
  type RegistryConfigFile,
} from "@civic-registry/config";
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENT_TYPES,
  notificationEventTitle,
  notificationMatchesSubscription,
  type InternalNotification,
  type NotificationChannel,
  type NotificationDelivery,
  type NotificationEvent,
  type NotificationEventType,
  type NotificationScope,
  type NotificationSubscription,
  type NotificationSubscriptionFilters,
  type NotificationTarget,
  type Visibility,
} from "@civic-registry/core";
import type {
  Pool,
  QueryResultRow,
} from "pg";

import {
  PersistenceConflictError,
  PersistenceNotFoundError,
  PostgresRegistryConfigRepository,
} from "./repositories.ts";

export interface CreateNotificationSubscriptionInput {
  registryId: string;
  scope: NotificationScope;
  channel: NotificationChannel;
  target: NotificationTarget;
  eventTypes: NotificationEventType[];
  filters?: NotificationSubscriptionFilters;
  actorId?: string;
  now?: string;
}

export interface NotificationRunResult {
  collected: number;
  materialized: number;
  dispatched: number;
  failed: number;
  suppressed: number;
}

export class NotificationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "NotificationError";
    this.code = code;
  }
}

interface NotificationSettings {
  registryName: string;
  eventTypes: ReadonlySet<NotificationEventType>;
  allowedChannels: ReadonlySet<NotificationChannel>;
  deadlineApproachingDays: number;
  maxDeliveryAttempts: number;
  retryBaseSeconds: number;
}

interface SubscriptionRow extends QueryResultRow {
  registry_id: string;
  id: string;
  scope: NotificationScope;
  channel: NotificationChannel;
  target: NotificationTarget;
  event_types: NotificationEventType[];
  filters: NotificationSubscriptionFilters;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
  actor_id: string | null;
}

interface EventRow extends QueryResultRow {
  registry_id: string;
  id: string;
  event_type: NotificationEventType;
  subject_type: NotificationEvent["subjectType"];
  subject_id: string;
  visibility: Visibility;
  occurred_at: Date;
  dedupe_key: string;
  payload: NotificationEvent["payload"];
}

interface DeliveryRow extends QueryResultRow {
  registry_id: string;
  id: string;
  event_id: string;
  subscription_id: string;
  channel: NotificationChannel;
  target: NotificationTarget;
  status: NotificationDelivery["status"] | "processing";
  attempts: number;
  next_attempt_at: Date | null;
  last_attempt_at: Date | null;
  last_error: string | null;
  created_at: Date;
  sent_at: Date | null;
}

interface InternalNotificationRow extends QueryResultRow {
  registry_id: string;
  id: string;
  delivery_id: string;
  event_id: string;
  recipient_id: string;
  title: string;
  body: string;
  created_at: Date;
  read_at: Date | null;
}

function mapSubscription(
  row: SubscriptionRow,
): NotificationSubscription {
  return {
    id: row.id,
    registryId: row.registry_id,
    scope: row.scope,
    channel: row.channel,
    target: row.target,
    eventTypes: row.event_types ?? [],
    filters: row.filters ?? {},
    enabled: row.enabled,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    actorId: row.actor_id ?? undefined,
  };
}

function mapEvent(row: EventRow): NotificationEvent {
  return {
    id: row.id,
    registryId: row.registry_id,
    eventType: row.event_type,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    visibility: row.visibility,
    occurredAt: row.occurred_at.toISOString(),
    dedupeKey: row.dedupe_key,
    payload: row.payload ?? {},
  };
}

function mapDelivery(
  row: DeliveryRow,
): NotificationDelivery {
  return {
    id: row.id,
    registryId: row.registry_id,
    eventId: row.event_id,
    subscriptionId: row.subscription_id,
    channel: row.channel,
    target: row.target,
    status:
      row.status === "processing"
        ? "pending"
        : row.status,
    attempts: row.attempts,
    nextAttemptAt:
      row.next_attempt_at?.toISOString(),
    lastAttemptAt:
      row.last_attempt_at?.toISOString(),
    lastError: row.last_error ?? undefined,
    createdAt: row.created_at.toISOString(),
    sentAt: row.sent_at?.toISOString(),
  };
}

function mapInternalNotification(
  row: InternalNotificationRow,
): InternalNotification {
  return {
    id: row.id,
    registryId: row.registry_id,
    deliveryId: row.delivery_id,
    eventId: row.event_id,
    recipientId: row.recipient_id,
    title: row.title,
    body: row.body,
    createdAt: row.created_at.toISOString(),
    readAt: row.read_at?.toISOString(),
  };
}

function normalizedStrings(
  values: string[] | undefined,
): string[] | undefined {
  if (!values) return undefined;

  const normalized = [
    ...new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];

  return normalized.length > 0
    ? normalized
    : undefined;
}

function normalizeFilters(
  filters: NotificationSubscriptionFilters | undefined,
): NotificationSubscriptionFilters {
  return {
    recordTypeIds: normalizedStrings(
      filters?.recordTypeIds,
    ),
    recordIds: normalizedStrings(
      filters?.recordIds,
    ),
    statusIds: normalizedStrings(
      filters?.statusIds,
    ),
    tags: normalizedStrings(filters?.tags),
  };
}

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    value,
  );
}

function ipv4Private(value: string): boolean {
  const octets = value
    .split(".")
    .map((part) => Number.parseInt(part, 10));

  if (
    octets.length !== 4 ||
    octets.some(
      (octet) =>
        !Number.isInteger(octet) ||
        octet < 0 ||
        octet > 255,
    )
  ) {
    return true;
  }

  const [a, b] = octets;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function privateAddress(value: string): boolean {
  const version = isIP(value);

  if (version === 4) return ipv4Private(value);

  if (version === 6) {
    const normalized = value.toLowerCase();

    if (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized)
    ) {
      return true;
    }

    const mapped =
      normalized.match(
        /^::ffff:(\d+\.\d+\.\d+\.\d+)$/,
      );

    if (mapped?.[1]) {
      return ipv4Private(mapped[1]);
    }

    return false;
  }

  return true;
}

function validateTarget(
  channel: NotificationChannel,
  target: NotificationTarget,
): void {
  if (channel === "email") {
    if (
      !("email" in target) ||
      typeof target.email !== "string" ||
      !validEmail(target.email.trim())
    ) {
      throw new NotificationError(
        "invalid_email_target",
        "Email notification targets require a valid email address.",
      );
    }
    return;
  }

  if (channel === "internal") {
    if (
      !("recipientId" in target) ||
      typeof target.recipientId !== "string" ||
      !target.recipientId.trim()
    ) {
      throw new NotificationError(
        "invalid_internal_target",
        "Internal notification targets require a recipientId.",
      );
    }
    return;
  }

  if (
    !("url" in target) ||
    typeof target.url !== "string" ||
    !("secret" in target) ||
    typeof target.secret !== "string" ||
    target.secret.trim().length < 16
  ) {
    throw new NotificationError(
      "invalid_webhook_target",
      "Webhook notification targets require an HTTPS URL and a signing secret of at least 16 characters.",
    );
  }

  let url: URL;

  try {
    url = new URL(target.url);
  } catch {
    throw new NotificationError(
      "invalid_webhook_url",
      "Webhook URL is invalid.",
    );
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !url.hostname ||
    url.hostname.toLowerCase() === "localhost" ||
    url.hostname.toLowerCase().endsWith(
      ".localhost",
    ) ||
    (isIP(url.hostname) > 0 &&
      privateAddress(url.hostname))
  ) {
    throw new NotificationError(
      "unsafe_webhook_url",
      "Webhook URLs must use HTTPS and cannot target local or private network addresses.",
    );
  }
}

async function assertWebhookDestination(
  value: string,
): Promise<URL> {
  const url = new URL(value);
  const addresses = await lookup(url.hostname, {
    all: true,
    verbatim: true,
  });

  if (
    addresses.length === 0 ||
    addresses.some((entry) =>
      privateAddress(entry.address),
    )
  ) {
    throw new NotificationError(
      "unsafe_webhook_destination",
      "Webhook hostname resolves to a private, local, or reserved network address.",
    );
  }

  return url;
}

function cleanTarget(
  channel: NotificationChannel,
  target: NotificationTarget,
): NotificationTarget {
  if (channel === "email" && "email" in target) {
    return {
      email: target.email.trim().toLowerCase(),
    };
  }

  if (
    channel === "internal" &&
    "recipientId" in target
  ) {
    return {
      recipientId: target.recipientId.trim(),
    };
  }

  if (
    channel === "webhook" &&
    "url" in target
  ) {
    return {
      url: target.url.trim(),
      secret: target.secret?.trim(),
    };
  }

  return target;
}

function bodyForEvent(
  registryName: string,
  event: NotificationEvent,
): string {
  const lines = [
    notificationEventTitle(event.eventType),
    registryName,
    `${event.subjectType}: ${event.subjectId}`,
    `Occurred: ${event.occurredAt}`,
  ];

  const status = event.payload.status;
  const dueAt = event.payload.dueAt;
  const documentTitle =
    event.payload.documentTitle;

  if (typeof status === "string") {
    lines.push(`Status: ${status}`);
  }

  if (typeof dueAt === "string") {
    lines.push(`Due: ${dueAt}`);
  }

  if (typeof documentTitle === "string") {
    lines.push(`Document: ${documentTitle}`);
  }

  return lines.join("\n");
}

async function sendEmailRelay(
  registryName: string,
  delivery: NotificationDelivery,
  event: NotificationEvent,
): Promise<void> {
  if (!("email" in delivery.target)) {
    throw new NotificationError(
      "invalid_email_delivery",
      "Email delivery target is malformed.",
    );
  }

  const relayUrl = (
    process.env.CIVIC_REGISTRY_EMAIL_RELAY_URL ??
    ""
  ).trim();
  const relayToken = (
    process.env.CIVIC_REGISTRY_EMAIL_RELAY_TOKEN ??
    ""
  ).trim();
  const from = (
    process.env.CIVIC_REGISTRY_EMAIL_FROM ?? ""
  ).trim();

  if (!relayUrl || !relayToken || !from) {
    throw new NotificationError(
      "email_relay_not_configured",
      "Email delivery requires CIVIC_REGISTRY_EMAIL_RELAY_URL, CIVIC_REGISTRY_EMAIL_RELAY_TOKEN, and CIVIC_REGISTRY_EMAIL_FROM.",
    );
  }

  const url = new URL(relayUrl);

  if (
    process.env.NODE_ENV === "production" &&
    url.protocol !== "https:"
  ) {
    throw new NotificationError(
      "unsafe_email_relay",
      "Production email relay URLs must use HTTPS.",
    );
  }

  const response = await fetch(url, {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${relayToken}`,
    },
    body: JSON.stringify({
      to: delivery.target.email,
      from,
      subject:
        `[${registryName}] ` +
        notificationEventTitle(event.eventType),
      text: bodyForEvent(registryName, event),
      metadata: {
        registryId: event.registryId,
        eventId: event.id,
        eventType: event.eventType,
        deliveryId: delivery.id,
      },
    }),
  });

  if (!response.ok) {
    throw new NotificationError(
      "email_delivery_failed",
      `Email relay returned HTTP ${response.status}.`,
    );
  }
}

async function sendWebhook(
  delivery: NotificationDelivery,
  event: NotificationEvent,
): Promise<void> {
  if (
    !("url" in delivery.target) ||
    !delivery.target.secret
  ) {
    throw new NotificationError(
      "invalid_webhook_delivery",
      "Webhook delivery target is malformed.",
    );
  }

  const url = await assertWebhookDestination(
    delivery.target.url,
  );
  const payload = JSON.stringify({
    deliveryId: delivery.id,
    event,
  });
  const signature = createHmac(
    "sha256",
    delivery.target.secret,
  )
    .update(payload)
    .digest("hex");

  const response = await fetch(url, {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
    headers: {
      "content-type": "application/json",
      "user-agent":
        "civic-registry-transparency-engine/notifications",
      "x-civic-registry-delivery": delivery.id,
      "x-civic-registry-event": event.eventType,
      "x-civic-registry-signature":
        `sha256=${signature}`,
    },
    body: payload,
  });

  if (
    response.status < 200 ||
    response.status >= 300
  ) {
    throw new NotificationError(
      "webhook_delivery_failed",
      `Webhook returned HTTP ${response.status}.`,
    );
  }
}

export class PostgresNotificationService {
  private readonly pool: Pool;
  private readonly configs: PostgresRegistryConfigRepository;

  constructor(pool: Pool) {
    this.pool = pool;
    this.configs =
      new PostgresRegistryConfigRepository(pool);
  }

  private async settings(
    registryId: string,
  ): Promise<{
    config: RegistryConfigFile;
    settings: NotificationSettings;
  }> {
    const config = await this.configs.get(registryId);

    if (!config) {
      throw new PersistenceNotFoundError(
        `Registry configuration ${registryId} does not exist.`,
      );
    }

    const compiled =
      compileRegistryConfig(config);
    const resolved =
      compiled.notifications;

    if (!resolved.enabled) {
      throw new NotificationError(
        "notifications_disabled",
        `Notifications are not enabled for registry ${registryId}.`,
      );
    }

    return {
      config,
      settings: {
        registryName: config.registry.name,
        eventTypes: resolved.eventTypes,
        allowedChannels:
          resolved.allowedChannels,
        deadlineApproachingDays:
          resolved.deadlineApproachingDays,
        maxDeliveryAttempts:
          resolved.maxDeliveryAttempts,
        retryBaseSeconds:
          resolved.retryBaseSeconds,
      },
    };
  }

  async createSubscription(
    input: CreateNotificationSubscriptionInput,
  ): Promise<NotificationSubscription> {
    const { config, settings } =
      await this.settings(input.registryId);
    const compiled = compileRegistryConfig(config);

    if (
      !settings.allowedChannels.has(input.channel)
    ) {
      throw new NotificationError(
        "channel_not_allowed",
        `Notification channel ${input.channel} is not enabled for this registry.`,
      );
    }

    const eventTypes = [
      ...new Set(input.eventTypes),
    ];

    if (
      eventTypes.length === 0 ||
      eventTypes.some(
        (eventType) =>
          !settings.eventTypes.has(eventType),
      )
    ) {
      throw new NotificationError(
        "event_not_allowed",
        "Subscription event types must be enabled by registry notification configuration.",
      );
    }

    validateTarget(input.channel, input.target);
    const filters = normalizeFilters(input.filters);

    for (const recordTypeId of
      filters.recordTypeIds ?? []) {
      if (
        !compiled.recordTypesById.has(recordTypeId)
      ) {
        throw new NotificationError(
          "unknown_record_type_filter",
          `Unknown record type filter: ${recordTypeId}.`,
        );
      }
    }

    if (
      filters.statusIds?.length &&
      compiled.publicationLifecycle
    ) {
      for (const statusId of filters.statusIds) {
        if (
          !compiled.publicationLifecycle
            .statusesById.has(statusId)
        ) {
          throw new NotificationError(
            "unknown_status_filter",
            `Unknown lifecycle status filter: ${statusId}.`,
          );
        }
      }
    }

    const id = randomUUID();
    const now =
      input.now ?? new Date().toISOString();
    const target = cleanTarget(
      input.channel,
      input.target,
    );

    const result =
      await this.pool.query<SubscriptionRow>(
        `
          INSERT INTO civic_registry_notification_subscriptions (
            registry_id,
            id,
            scope,
            channel,
            target,
            event_types,
            filters,
            enabled,
            created_at,
            updated_at,
            actor_id
          )
          VALUES (
            $1, $2, $3, $4, $5::jsonb,
            $6::text[], $7::jsonb, TRUE,
            $8::timestamptz, $8::timestamptz, $9
          )
          RETURNING *
        `,
        [
          input.registryId,
          id,
          input.scope,
          input.channel,
          JSON.stringify(target),
          eventTypes,
          JSON.stringify(filters),
          now,
          input.actorId ?? null,
        ],
      );

    await this.insertAuditEvent(
      input.registryId,
      id,
      "notification.subscription_created",
      input.actorId,
      now,
      {
        scope: input.scope,
        channel: input.channel,
        eventTypes,
      },
    );

    return mapSubscription(result.rows[0]);
  }

  async listSubscriptions(
    registryId: string,
    options: {
      enabled?: boolean;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<NotificationSubscription[]> {
    const values: unknown[] = [registryId];
    const where = ["registry_id = $1"];

    if (options.enabled !== undefined) {
      values.push(options.enabled);
      where.push(
        `enabled = $${values.length}`,
      );
    }

    const limit = Math.max(
      1,
      Math.min(
        Math.trunc(options.limit ?? 100),
        500,
      ),
    );
    const offset = Math.max(
      0,
      Math.trunc(options.offset ?? 0),
    );

    const result =
      await this.pool.query<SubscriptionRow>(
        `
          SELECT *
          FROM civic_registry_notification_subscriptions
          WHERE ${where.join(" AND ")}
          ORDER BY created_at DESC, id DESC
          LIMIT ${limit}
          OFFSET ${offset}
        `,
        values,
      );

    return result.rows.map(mapSubscription);
  }

  async setSubscriptionEnabled(
    registryId: string,
    subscriptionId: string,
    enabled: boolean,
    actorId?: string,
    now = new Date().toISOString(),
  ): Promise<NotificationSubscription> {
    await this.settings(registryId);

    const result =
      await this.pool.query<SubscriptionRow>(
        `
          UPDATE civic_registry_notification_subscriptions
          SET
            enabled = $3,
            updated_at = $4::timestamptz,
            actor_id = $5
          WHERE registry_id = $1
            AND id = $2
          RETURNING *
        `,
        [
          registryId,
          subscriptionId,
          enabled,
          now,
          actorId ?? null,
        ],
      );

    if (!result.rows[0]) {
      throw new PersistenceNotFoundError(
        `Notification subscription ${registryId}/${subscriptionId} does not exist.`,
      );
    }

    await this.insertAuditEvent(
      registryId,
      subscriptionId,
      enabled
        ? "notification.subscription_enabled"
        : "notification.subscription_disabled",
      actorId,
      now,
      {},
    );

    return mapSubscription(result.rows[0]);
  }

  async deleteSubscription(
    registryId: string,
    subscriptionId: string,
    actorId?: string,
    now = new Date().toISOString(),
  ): Promise<boolean> {
    await this.settings(registryId);

    const result = await this.pool.query(
      `
        DELETE FROM civic_registry_notification_subscriptions
        WHERE registry_id = $1
          AND id = $2
      `,
      [registryId, subscriptionId],
    );

    const deleted = (result.rowCount ?? 0) > 0;

    if (deleted) {
      await this.insertAuditEvent(
        registryId,
        subscriptionId,
        "notification.subscription_deleted",
        actorId,
        now,
        {},
      );
    }

    return deleted;
  }

  async collectEvents(
    registryId: string,
    now = new Date().toISOString(),
  ): Promise<number> {
    const { settings } =
      await this.settings(registryId);
    let collected = 0;

    const auditSources: string[] = [];

    if (
      settings.eventTypes.has(
        "record.published",
      )
    ) {
      auditSources.push("record.published");
    }

    if (
      settings.eventTypes.has(
        "record.matching_created",
      )
    ) {
      auditSources.push("record.created");
    }

    if (
      settings.eventTypes.has("record.changed")
    ) {
      auditSources.push(
        "record.fields_changed",
        "record.status_changed",
        "record.visibility_changed",
        "record.metadata_changed",
      );
    }

    if (auditSources.length > 0) {
      const result = await this.pool.query(
        `
          INSERT INTO civic_registry_notification_events (
            registry_id,
            id,
            event_type,
            subject_type,
            subject_id,
            visibility,
            occurred_at,
            dedupe_key,
            payload
          )
          SELECT
            event.registry_id,
            'audit-' || event.id::text,
            CASE
              WHEN event.event_type = 'record.published'
                THEN 'record.published'
              WHEN event.event_type = 'record.created'
                THEN 'record.matching_created'
              ELSE 'record.changed'
            END,
            'record',
            record.id,
            CASE
              WHEN event.visibility = 'public'
                AND record.visibility = 'public'
                AND NOT EXISTS (
                  SELECT 1
                  FROM civic_registry_record_disclosures AS disclosure
                  WHERE disclosure.registry_id = record.registry_id
                    AND disclosure.record_id = record.id
                    AND disclosure.disposition = 'withheld'
                )
                THEN 'public'
              ELSE 'private'
            END,
            event.occurred_at,
            'audit:' || event.id::text,
            jsonb_strip_nulls(
              jsonb_build_object(
                'recordId', record.id,
                'recordTypeId', record.record_type_id,
                'status', record.status,
                'tags', to_jsonb(record.tags),
                'sourceEventType', event.event_type
              )
            )
          FROM civic_registry_audit_events AS event
          INNER JOIN civic_registry_records AS record
            ON record.registry_id = event.registry_id
            AND record.id = event.subject_id
          WHERE event.registry_id = $1
            AND event.subject_type = 'record'
            AND event.event_type =
              ANY($2::text[])
          ON CONFLICT (
            registry_id,
            dedupe_key
          )
          DO UPDATE SET
            visibility = EXCLUDED.visibility,
            payload = EXCLUDED.payload
          WHERE
            civic_registry_notification_events.visibility
              IS DISTINCT FROM EXCLUDED.visibility
            OR civic_registry_notification_events.payload
              IS DISTINCT FROM EXCLUDED.payload
        `,
        [registryId, auditSources],
      );

      collected += result.rowCount ?? 0;
    }

    if (
      settings.eventTypes.has("document.added")
    ) {
      const result = await this.pool.query(
        `
          INSERT INTO civic_registry_notification_events (
            registry_id,
            id,
            event_type,
            subject_type,
            subject_id,
            visibility,
            occurred_at,
            dedupe_key,
            payload
          )
          SELECT
            document.registry_id,
            'document-' || md5(
              document.registry_id || ':' || document.id
            ),
            'document.added',
            'document',
            document.id,
            CASE
              WHEN document.visibility = 'public'
                AND COALESCE(
                  disclosure.disposition,
                  'disclosed'
                ) = 'disclosed'
                THEN 'public'
              ELSE 'private'
            END,
            document.created_at,
            'document:' || document.id,
            jsonb_strip_nulls(
              jsonb_build_object(
                'documentId', document.id,
                'documentTitle', document.title,
                'sourceId', document.source_id,
                'mimeType', document.mime_type
              )
            )
          FROM civic_registry_documents AS document
          LEFT JOIN civic_registry_document_disclosures AS disclosure
            ON disclosure.registry_id = document.registry_id
            AND disclosure.document_id = document.id
          WHERE document.registry_id = $1
          ON CONFLICT (
            registry_id,
            dedupe_key
          )
          DO UPDATE SET
            visibility = EXCLUDED.visibility,
            payload = EXCLUDED.payload
          WHERE
            civic_registry_notification_events.visibility
              IS DISTINCT FROM EXCLUDED.visibility
            OR civic_registry_notification_events.payload
              IS DISTINCT FROM EXCLUDED.payload
        `,
        [registryId],
      );

      collected += result.rowCount ?? 0;
    }

    const deadlineEvents: Array<{
      eventType:
        | "deadline.approaching"
        | "deadline.missed";
      predicate: string;
    }> = [];

    if (
      settings.eventTypes.has(
        "deadline.approaching",
      )
    ) {
      deadlineEvents.push({
        eventType: "deadline.approaching",
        predicate:
          "deadline.due_at >= $2::timestamptz AND deadline.due_at <= $2::timestamptz + ($3::int * INTERVAL '1 day')",
      });
    }

    if (
      settings.eventTypes.has("deadline.missed")
    ) {
      deadlineEvents.push({
        eventType: "deadline.missed",
        predicate:
          "deadline.due_at < $2::timestamptz",
      });
    }

    for (const entry of deadlineEvents) {
      const result = await this.pool.query(
        `
          INSERT INTO civic_registry_notification_events (
            registry_id,
            id,
            event_type,
            subject_type,
            subject_id,
            visibility,
            occurred_at,
            dedupe_key,
            payload
          )
          SELECT
            deadline.registry_id,
            'deadline-' || md5(
              deadline.id || ':' ||
              '${entry.eventType}' || ':' ||
              deadline.due_at::text
            ),
            '${entry.eventType}',
            'deadline',
            deadline.id,
            CASE
              WHEN civic_registry_deadline_is_public(
                deadline.registry_id,
                deadline.record_id,
                deadline.deadline_type_id
              )
              AND NOT EXISTS (
                SELECT 1
                FROM civic_registry_record_disclosures AS disclosure
                WHERE disclosure.registry_id = record.registry_id
                  AND disclosure.record_id = record.id
                  AND disclosure.disposition = 'withheld'
              )
                THEN 'public'
              ELSE 'private'
            END,
            CASE
              WHEN '${entry.eventType}' = 'deadline.missed'
                THEN deadline.due_at
              ELSE $2::timestamptz
            END,
            'deadline:' || deadline.id || ':' ||
              '${entry.eventType}' || ':' ||
              deadline.due_at::text,
            jsonb_strip_nulls(
              jsonb_build_object(
                'deadlineId', deadline.id,
                'deadlineTypeId', deadline.deadline_type_id,
                'dueAt', deadline.due_at,
                'recordId', record.id,
                'recordTypeId', record.record_type_id,
                'status', record.status,
                'tags', to_jsonb(record.tags)
              )
            )
          FROM civic_registry_deadlines AS deadline
          INNER JOIN civic_registry_records AS record
            ON record.registry_id = deadline.registry_id
            AND record.id = deadline.record_id
          WHERE deadline.registry_id = $1
            AND deadline.state = 'open'
            AND ${entry.predicate}
          ON CONFLICT (
            registry_id,
            dedupe_key
          )
          DO UPDATE SET
            visibility = EXCLUDED.visibility,
            payload = EXCLUDED.payload
          WHERE
            civic_registry_notification_events.visibility
              IS DISTINCT FROM EXCLUDED.visibility
            OR civic_registry_notification_events.payload
              IS DISTINCT FROM EXCLUDED.payload
        `,
        [
          registryId,
          now,
          settings.deadlineApproachingDays,
        ],
      );

      collected += result.rowCount ?? 0;
    }

    return collected;
  }

  async materializeDeliveries(
    registryId: string,
    now = new Date().toISOString(),
  ): Promise<number> {
    await this.settings(registryId);

    const subscriptions: NotificationSubscription[] =
      [];
    let subscriptionOffset = 0;

    while (true) {
      const page = await this.listSubscriptions(
        registryId,
        {
          enabled: true,
          limit: 500,
          offset: subscriptionOffset,
        },
      );
      subscriptions.push(...page);

      if (page.length < 500) break;
      subscriptionOffset += page.length;
    }

    if (subscriptions.length === 0) return 0;

    let created = 0;
    let eventOffset = 0;

    while (true) {
      const events = await this.listEvents(
        registryId,
        {
          limit: 1000,
          offset: eventOffset,
        },
      );

      for (const subscription of subscriptions) {
        const createdAt =
          Date.parse(subscription.createdAt);

        for (const event of events) {
          if (
            Date.parse(event.occurredAt) < createdAt ||
            !notificationMatchesSubscription(
              event,
              subscription,
            )
          ) {
            continue;
          }

          const result = await this.pool.query(
            `
              INSERT INTO civic_registry_notification_deliveries (
                registry_id,
                id,
                event_id,
                subscription_id,
                channel,
                target,
                status,
                attempts,
                next_attempt_at,
                created_at
              )
              VALUES (
                $1, $2, $3, $4, $5, $6::jsonb,
                'pending', 0, $7::timestamptz,
                $7::timestamptz
              )
              ON CONFLICT (
                registry_id,
                event_id,
                subscription_id
              )
              DO NOTHING
            `,
            [
              registryId,
              randomUUID(),
              event.id,
              subscription.id,
              subscription.channel,
              JSON.stringify(
                subscription.target,
              ),
              now,
            ],
          );

          created += result.rowCount ?? 0;
        }
      }

      if (events.length < 1000) break;
      eventOffset += events.length;
    }

    return created;
  }

  async listEvents(
    registryId: string,
    options: {
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<NotificationEvent[]> {
    const limit = Math.max(
      1,
      Math.min(
        Math.trunc(options.limit ?? 100),
        5000,
      ),
    );
    const offset = Math.max(
      0,
      Math.trunc(options.offset ?? 0),
    );

    const result =
      await this.pool.query<EventRow>(
        `
          SELECT *
          FROM civic_registry_notification_events
          WHERE registry_id = $1
          ORDER BY occurred_at DESC, id DESC
          LIMIT ${limit}
          OFFSET ${offset}
        `,
        [registryId],
      );

    return result.rows.map(mapEvent);
  }

  async listDeliveries(
    registryId: string,
    options: {
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<NotificationDelivery[]> {
    const limit = Math.max(
      1,
      Math.min(
        Math.trunc(options.limit ?? 100),
        500,
      ),
    );
    const offset = Math.max(
      0,
      Math.trunc(options.offset ?? 0),
    );

    const result =
      await this.pool.query<DeliveryRow>(
        `
          SELECT *
          FROM civic_registry_notification_deliveries
          WHERE registry_id = $1
          ORDER BY created_at DESC, id DESC
          LIMIT ${limit}
          OFFSET ${offset}
        `,
        [registryId],
      );

    return result.rows.map(mapDelivery);
  }

  async listInternalNotifications(
    registryId: string,
    recipientId: string,
    options: {
      unreadOnly?: boolean;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<InternalNotification[]> {
    const values: unknown[] = [
      registryId,
      recipientId,
    ];
    const where = [
      "registry_id = $1",
      "recipient_id = $2",
    ];

    if (options.unreadOnly) {
      where.push("read_at IS NULL");
    }

    const limit = Math.max(
      1,
      Math.min(
        Math.trunc(options.limit ?? 100),
        500,
      ),
    );
    const offset = Math.max(
      0,
      Math.trunc(options.offset ?? 0),
    );

    const result =
      await this.pool.query<InternalNotificationRow>(
        `
          SELECT *
          FROM civic_registry_internal_notifications
          WHERE ${where.join(" AND ")}
          ORDER BY created_at DESC, id DESC
          LIMIT ${limit}
          OFFSET ${offset}
        `,
        values,
      );

    return result.rows.map(
      mapInternalNotification,
    );
  }

  async markInternalNotificationRead(
    registryId: string,
    notificationId: string,
    recipientId: string,
    now = new Date().toISOString(),
  ): Promise<boolean> {
    const result = await this.pool.query(
      `
        UPDATE civic_registry_internal_notifications
        SET read_at = COALESCE(
          read_at,
          $4::timestamptz
        )
        WHERE registry_id = $1
          AND id = $2
          AND recipient_id = $3
      `,
      [
        registryId,
        notificationId,
        recipientId,
        now,
      ],
    );

    return (result.rowCount ?? 0) > 0;
  }

  async dispatchPending(
    registryId: string,
    options: {
      limit?: number;
      now?: string;
    } = {},
  ): Promise<{
    dispatched: number;
    failed: number;
    suppressed: number;
  }> {
    const { config, settings } =
      await this.settings(registryId);
    const now =
      options.now ?? new Date().toISOString();
    const limit = Math.max(
      1,
      Math.min(
        Math.trunc(options.limit ?? 100),
        500,
      ),
    );

    const claimed =
      await this.pool.query<DeliveryRow>(
        `
          WITH candidates AS (
            SELECT
              registry_id,
              id
            FROM civic_registry_notification_deliveries
            WHERE registry_id = $1
              AND attempts < $2
              AND (
                (
                  status = 'pending'
                  AND (
                    next_attempt_at IS NULL
                    OR next_attempt_at <=
                      $3::timestamptz
                  )
                )
                OR (
                  status = 'processing'
                  AND last_attempt_at <
                    $3::timestamptz -
                    INTERVAL '15 minutes'
                )
              )
            ORDER BY
              COALESCE(
                next_attempt_at,
                created_at
              ) ASC,
              created_at ASC,
              id ASC
            FOR UPDATE SKIP LOCKED
            LIMIT ${limit}
          )
          UPDATE civic_registry_notification_deliveries
          AS delivery
          SET
            status = 'processing',
            attempts = delivery.attempts + 1,
            last_attempt_at = $3::timestamptz
          FROM candidates
          WHERE delivery.registry_id =
              candidates.registry_id
            AND delivery.id = candidates.id
          RETURNING delivery.*
        `,
        [
          registryId,
          settings.maxDeliveryAttempts,
          now,
        ],
      );

    let dispatched = 0;
    let failed = 0;
    let suppressed = 0;

    for (const row of claimed.rows) {
      const delivery = mapDelivery(row);
      const [event, subscription] =
        await Promise.all([
          this.getEvent(
            registryId,
            delivery.eventId,
          ),
          this.getSubscription(
            registryId,
            delivery.subscriptionId,
          ),
        ]);

      if (!event) {
        await this.failDelivery(
          row,
          settings,
          now,
          new Error("Notification event no longer exists."),
        );
        failed += 1;
        continue;
      }

      if (
        !subscription ||
        !subscription.enabled
      ) {
        await this.suppressDelivery(
          row,
          "Subscription is no longer enabled.",
        );
        suppressed += 1;
        continue;
      }

      if (
        subscription.scope === "public" &&
        !(await this.eventStillPublic(
          event,
          config,
        ))
      ) {
        await this.suppressDelivery(
          row,
          "Event is no longer eligible for public delivery.",
        );
        suppressed += 1;
        continue;
      }

      try {
        if (row.channel === "internal") {
          await this.deliverInternal(
            row,
            event,
            settings.registryName,
            now,
          );
        } else if (row.channel === "email") {
          await sendEmailRelay(
            settings.registryName,
            delivery,
            event,
          );
        } else {
          await sendWebhook(
            delivery,
            event,
          );
        }

        await this.pool.query(
          `
            UPDATE civic_registry_notification_deliveries
            SET
              status = 'sent',
              sent_at = $3::timestamptz,
              next_attempt_at = NULL,
              last_error = NULL
            WHERE registry_id = $1
              AND id = $2
          `,
          [registryId, row.id, now],
        );
        dispatched += 1;
      } catch (error) {
        await this.failDelivery(
          row,
          settings,
          now,
          error,
        );
        failed += 1;
      }
    }

    return {
      dispatched,
      failed,
      suppressed,
    };
  }

  async run(
    registryId: string,
    options: {
      now?: string;
      dispatchLimit?: number;
    } = {},
  ): Promise<NotificationRunResult> {
    const now =
      options.now ?? new Date().toISOString();
    const collected =
      await this.collectEvents(registryId, now);
    const materialized =
      await this.materializeDeliveries(
        registryId,
        now,
      );
    const dispatched =
      await this.dispatchPending(registryId, {
        now,
        limit: options.dispatchLimit,
      });

    return {
      collected,
      materialized,
      dispatched: dispatched.dispatched,
      failed: dispatched.failed,
      suppressed: dispatched.suppressed,
    };
  }

  private async getSubscription(
    registryId: string,
    subscriptionId: string,
  ): Promise<NotificationSubscription | null> {
    const result =
      await this.pool.query<SubscriptionRow>(
        `
          SELECT *
          FROM civic_registry_notification_subscriptions
          WHERE registry_id = $1
            AND id = $2
        `,
        [registryId, subscriptionId],
      );

    return result.rows[0]
      ? mapSubscription(result.rows[0])
      : null;
  }

  private async eventStillPublic(
    event: NotificationEvent,
    config: RegistryConfigFile,
  ): Promise<boolean> {
    if (event.visibility !== "public") {
      return false;
    }

    if (event.subjectType === "document") {
      const result = await this.pool.query<{
        visibility: Visibility;
        disposition: string | null;
      }>(
        `
          SELECT
            document.visibility,
            disclosure.disposition
          FROM civic_registry_documents AS document
          LEFT JOIN civic_registry_document_disclosures
            AS disclosure
            ON disclosure.registry_id =
              document.registry_id
            AND disclosure.document_id =
              document.id
          WHERE document.registry_id = $1
            AND document.id = $2
        `,
        [event.registryId, event.subjectId],
      );
      const row = result.rows[0];

      return (
        row?.visibility === "public" &&
        (row.disposition === null ||
          row.disposition === "disclosed")
      );
    }

    if (event.subjectType === "deadline") {
      const result = await this.pool.query<{
        is_public: boolean;
      }>(
        `
          SELECT
            (
              deadline.state = 'open'
              AND civic_registry_deadline_is_public(
                deadline.registry_id,
                deadline.record_id,
                deadline.deadline_type_id
              )
              AND NOT EXISTS (
                SELECT 1
                FROM civic_registry_record_disclosures
                  AS disclosure
                WHERE disclosure.registry_id =
                    deadline.registry_id
                  AND disclosure.record_id =
                    deadline.record_id
                  AND disclosure.disposition =
                    'withheld'
              )
            ) AS is_public
          FROM civic_registry_deadlines AS deadline
          WHERE deadline.registry_id = $1
            AND deadline.id = $2
        `,
        [event.registryId, event.subjectId],
      );

      if (result.rows[0]?.is_public !== true) {
        return false;
      }
    }

    const payloadRecordId =
      event.payload.recordId;
    const recordId =
      typeof payloadRecordId === "string"
        ? payloadRecordId
        : event.subjectType === "record"
          ? event.subjectId
          : undefined;

    if (!recordId) {
      return false;
    }

    const recordResult =
      await this.pool.query<{
        visibility: Visibility;
        status: string;
        disposition: string | null;
      }>(
        `
          SELECT
            record.visibility,
            record.status,
            disclosure.disposition
          FROM civic_registry_records AS record
          LEFT JOIN civic_registry_record_disclosures
            AS disclosure
            ON disclosure.registry_id =
              record.registry_id
            AND disclosure.record_id =
              record.id
          WHERE record.registry_id = $1
            AND record.id = $2
        `,
        [event.registryId, recordId],
      );
    const record = recordResult.rows[0];

    if (
      !record ||
      record.visibility !== "public" ||
      record.disposition === "withheld"
    ) {
      return false;
    }

    const compiled = compileRegistryConfig(config);

    return (
      !compiled.publicationLifecycle ||
      compiled.publicationLifecycle.isPublicStatus(
        record.status,
      )
    );
  }

  private async suppressDelivery(
    delivery: DeliveryRow,
    reason: string,
  ): Promise<void> {
    await this.pool.query(
      `
        UPDATE civic_registry_notification_deliveries
        SET
          status = 'suppressed',
          next_attempt_at = NULL,
          last_error = $3
        WHERE registry_id = $1
          AND id = $2
      `,
      [
        delivery.registry_id,
        delivery.id,
        reason,
      ],
    );
  }

  private async getEvent(
    registryId: string,
    eventId: string,
  ): Promise<NotificationEvent | null> {
    const result =
      await this.pool.query<EventRow>(
        `
          SELECT *
          FROM civic_registry_notification_events
          WHERE registry_id = $1
            AND id = $2
        `,
        [registryId, eventId],
      );

    return result.rows[0]
      ? mapEvent(result.rows[0])
      : null;
  }

  private async deliverInternal(
    delivery: DeliveryRow,
    event: NotificationEvent,
    registryName: string,
    now: string,
  ): Promise<void> {
    if (!("recipientId" in delivery.target)) {
      throw new NotificationError(
        "invalid_internal_delivery",
        "Internal delivery target is malformed.",
      );
    }

    await this.pool.query(
      `
        INSERT INTO civic_registry_internal_notifications (
          registry_id,
          id,
          delivery_id,
          event_id,
          recipient_id,
          title,
          body,
          created_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8::timestamptz
        )
        ON CONFLICT (
          registry_id,
          delivery_id
        )
        DO NOTHING
      `,
      [
        delivery.registry_id,
        randomUUID(),
        delivery.id,
        event.id,
        delivery.target.recipientId,
        notificationEventTitle(
          event.eventType,
        ),
        bodyForEvent(registryName, event),
        now,
      ],
    );
  }

  private async failDelivery(
    delivery: DeliveryRow,
    settings: NotificationSettings,
    now: string,
    error: unknown,
  ): Promise<void> {
    const terminal =
      delivery.attempts >=
      settings.maxDeliveryAttempts;
    const delaySeconds = Math.min(
      86_400,
      settings.retryBaseSeconds *
        2 ** Math.max(0, delivery.attempts - 1),
    );
    const nextAttemptAt = terminal
      ? null
      : new Date(
          Date.parse(now) +
            delaySeconds * 1000,
        ).toISOString();
    const message =
      error instanceof Error
        ? error.message
        : "Unknown notification delivery error.";

    await this.pool.query(
      `
        UPDATE civic_registry_notification_deliveries
        SET
          status = $3,
          next_attempt_at =
            $4::timestamptz,
          last_error = $5
        WHERE registry_id = $1
          AND id = $2
      `,
      [
        delivery.registry_id,
        delivery.id,
        terminal ? "failed" : "pending",
        nextAttemptAt,
        message.slice(0, 2000),
      ],
    );
  }

  private async insertAuditEvent(
    registryId: string,
    subscriptionId: string,
    eventType: string,
    actorId: string | undefined,
    occurredAt: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO civic_registry_audit_events (
          registry_id,
          subject_type,
          subject_id,
          event_type,
          occurred_at,
          visibility,
          actor_id,
          metadata
        )
        VALUES (
          $1, 'notification_subscription',
          $2, $3, $4::timestamptz,
          'private', $5, $6::jsonb
        )
      `,
      [
        registryId,
        subscriptionId,
        eventType,
        occurredAt,
        actorId ?? null,
        JSON.stringify(metadata),
      ],
    );
  }
}
