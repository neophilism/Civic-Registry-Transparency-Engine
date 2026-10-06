import { notFound } from "next/navigation";

import { AdminShell } from "../../../../../components/admin-shell";
import {
  createAdminNotificationSubscription,
  deleteAdminNotificationSubscription,
  markAdminNotificationRead,
  runAdminNotifications,
  setAdminNotificationSubscriptionEnabled,
} from "../../../actions";
import {
  requireAdminSession,
} from "../../../../../lib/admin-auth";
import {
  getAdminRegistry,
} from "../../../../../lib/admin-console";
import {
  getDatabasePool,
} from "../../../../../lib/database";
import { formatDateTime } from "../../../../../lib/format";
import {
  PostgresNotificationService,
} from "@civic-registry/database";

export const dynamic = "force-dynamic";

interface NotificationAdminPageProps {
  params: Promise<{ registryId: string }>;
  searchParams: Promise<{
    notice?: string;
    error?: string;
  }>;
}

function targetLabel(
  target:
    | { email: string }
    | { url: string; secret?: string }
    | { recipientId: string },
): string {
  if ("email" in target) return target.email;
  if ("url" in target) return target.url;
  return target.recipientId;
}

export default async function NotificationAdminPage({
  params,
  searchParams,
}: NotificationAdminPageProps) {
  const session = await requireAdminSession();
  const { registryId } = await params;
  const query = await searchParams;
  const registry = await getAdminRegistry(registryId);

  if (!registry) notFound();

  const config =
    registry.configFile.notifications;
  const returnTo =
    "/admin/registries/" +
    encodeURIComponent(registryId) +
    "/notifications";

  if (!config?.enabled) {
    return (
      <AdminShell
        session={session}
        registryId={registryId}
        title="Notifications"
        subtitle="Notifications are disabled for this registry. Enable the notifications block in registry configuration before creating subscriptions."
      >
        <div className="empty-state empty-state--inline">
          Notification processing is disabled by configuration.
        </div>
      </AdminShell>
    );
  }

  const service = new PostgresNotificationService(
    getDatabasePool(),
  );
  const [subscriptions, deliveries, inbox] =
    await Promise.all([
      service.listSubscriptions(registryId, {
        limit: 100,
      }),
      service.listDeliveries(registryId, {
        limit: 50,
      }),
      service.listInternalNotifications(
        registryId,
        session.actorId,
        { limit: 50 },
      ),
    ]);

  const eventTypes = config.eventTypes ?? [
    "record.published",
    "record.changed",
    "record.matching_created",
    "deadline.approaching",
    "deadline.missed",
    "document.added",
  ];
  const channels = config.allowedChannels ?? [
    "email",
    "webhook",
    "internal",
  ];

  return (
    <AdminShell
      session={session}
      registryId={registryId}
      title="Notifications"
      subtitle="Configure durable event subscriptions and inspect delivery state. Public-scope subscriptions can receive only public notification events."
    >
      {query.notice ? (
        <div className="admin-message">
          {query.notice}
        </div>
      ) : null}
      {query.error ? (
        <div className="admin-message admin-message--error">
          {query.error}
        </div>
      ) : null}

      <section className="admin-metrics">
        <div>
          <strong>{subscriptions.length}</strong>
          <span>Subscriptions</span>
        </div>
        <div>
          <strong>
            {
              deliveries.filter(
                (delivery) =>
                  delivery.status === "pending",
              ).length
            }
          </strong>
          <span>Pending deliveries</span>
        </div>
        <div>
          <strong>
            {
              deliveries.filter(
                (delivery) =>
                  delivery.status === "failed",
              ).length
            }
          </strong>
          <span>Failed deliveries</span>
        </div>
        <div>
          <strong>
            {
              inbox.filter(
                (notification) =>
                  !notification.readAt,
              ).length
            }
          </strong>
          <span>Unread internal</span>
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              Processing
            </p>
            <h2>Notification runner</h2>
          </div>
          <form action={runAdminNotifications}>
            <input
              type="hidden"
              name="registryId"
              value={registryId}
            />
            <input
              type="hidden"
              name="returnTo"
              value={returnTo}
            />
            <button className="button-link">
              Run now
            </button>
          </form>
        </div>
        <p className="lede">
          Production deployments should schedule{" "}
          <code>pnpm db:notifications-run</code>. Manual runs
          use the same idempotent collector and delivery
          pipeline.
        </p>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              Subscription management
            </p>
            <h2>Create subscription</h2>
          </div>
        </div>

        <form
          className="admin-form"
          action={createAdminNotificationSubscription}
        >
          <input
            type="hidden"
            name="registryId"
            value={registryId}
          />
          <input
            type="hidden"
            name="returnTo"
            value={returnTo}
          />

          <div className="admin-form__grid">
            <label>
              <span>Scope</span>
              <select name="scope" defaultValue="internal">
                <option value="internal">
                  Internal
                </option>
                <option value="public">
                  Public data only
                </option>
              </select>
            </label>

            <label>
              <span>Channel</span>
              <select name="channel">
                {channels.map((channel) => (
                  <option
                    key={channel}
                    value={channel}
                  >
                    {channel}
                  </option>
                ))}
              </select>
            </label>

            <label className="admin-form__wide">
              <span>
                Target
              </span>
              <input
                name="target"
                required
                placeholder="Email address, HTTPS webhook URL, or internal recipient ID"
              />
              <small>
                Internal recipient IDs normally match an
                administrator actor ID.
              </small>
            </label>

            <label className="admin-form__wide">
              <span>
                Webhook signing secret
              </span>
              <input
                name="webhookSecret"
                type="password"
                autoComplete="new-password"
                placeholder="Required only for webhook subscriptions; minimum 16 characters"
              />
            </label>

            <label className="admin-form__wide">
              <span>Event types</span>
              <input
                name="eventTypes"
                required
                defaultValue={eventTypes.join(",")}
              />
              <small>
                Enabled: {eventTypes.join(", ")}
              </small>
            </label>

            <label>
              <span>Record type filters</span>
              <input
                name="recordTypeIds"
                placeholder="document,organization"
              />
            </label>

            <label>
              <span>Status filters</span>
              <input
                name="statusIds"
                placeholder="published,withdrawn"
              />
            </label>

            <label>
              <span>Record ID filters</span>
              <input
                name="recordIds"
                placeholder="record-1,record-2"
              />
            </label>

            <label>
              <span>Tag filters</span>
              <input
                name="tags"
                placeholder="priority,quarterly"
              />
            </label>
          </div>

          <div className="admin-actions">
            <button type="submit">
              Create subscription
            </button>
          </div>
        </form>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              Active configuration
            </p>
            <h2>Subscriptions</h2>
          </div>
          <span className="metric">
            {subscriptions.length}
          </span>
        </div>

        {subscriptions.length === 0 ? (
          <div className="empty-state empty-state--inline">
            No notification subscriptions exist.
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Channel / target</th>
                  <th>Scope</th>
                  <th>Events</th>
                  <th>Filters</th>
                  <th>State</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map(
                  (subscription) => (
                    <tr key={subscription.id}>
                      <td>
                        <strong>
                          {subscription.channel}
                        </strong>
                        <small>
                          {targetLabel(
                            subscription.target,
                          )}
                        </small>
                      </td>
                      <td>{subscription.scope}</td>
                      <td>
                        {subscription.eventTypes.join(
                          ", ",
                        )}
                      </td>
                      <td>
                        <small>
                          {JSON.stringify(
                            subscription.filters,
                          )}
                        </small>
                      </td>
                      <td>
                        {subscription.enabled
                          ? "enabled"
                          : "disabled"}
                      </td>
                      <td>
                        <div className="admin-actions">
                          <form
                            action={
                              setAdminNotificationSubscriptionEnabled
                            }
                          >
                            <input
                              type="hidden"
                              name="registryId"
                              value={registryId}
                            />
                            <input
                              type="hidden"
                              name="subscriptionId"
                              value={subscription.id}
                            />
                            <input
                              type="hidden"
                              name="enabled"
                              value={
                                subscription.enabled
                                  ? "false"
                                  : "true"
                              }
                            />
                            <input
                              type="hidden"
                              name="returnTo"
                              value={returnTo}
                            />
                            <button
                              className="admin-button--quiet"
                            >
                              {subscription.enabled
                                ? "Disable"
                                : "Enable"}
                            </button>
                          </form>
                          <form
                            action={
                              deleteAdminNotificationSubscription
                            }
                          >
                            <input
                              type="hidden"
                              name="registryId"
                              value={registryId}
                            />
                            <input
                              type="hidden"
                              name="subscriptionId"
                              value={subscription.id}
                            />
                            <input
                              type="hidden"
                              name="returnTo"
                              value={returnTo}
                            />
                            <button
                              className="admin-button--quiet"
                            >
                              Delete
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              Internal channel
            </p>
            <h2>Your inbox</h2>
          </div>
          <span className="metric">
            {inbox.length}
          </span>
        </div>

        {inbox.length === 0 ? (
          <div className="empty-state empty-state--inline">
            No internal notifications for{" "}
            {session.actorId}.
          </div>
        ) : (
          <div className="admin-stack">
            {inbox.map((notification) => (
              <article
                className="admin-card"
                key={notification.id}
              >
                <div>
                  <strong>
                    {notification.title}
                  </strong>
                  <span>
                    {notification.body}
                  </span>
                  <small>
                    {formatDateTime(
                      notification.createdAt,
                    )}
                    {notification.readAt
                      ? " · read"
                      : " · unread"}
                  </small>
                </div>
                {!notification.readAt ? (
                  <form
                    action={
                      markAdminNotificationRead
                    }
                  >
                    <input
                      type="hidden"
                      name="registryId"
                      value={registryId}
                    />
                    <input
                      type="hidden"
                      name="notificationId"
                      value={notification.id}
                    />
                    <input
                      type="hidden"
                      name="returnTo"
                      value={returnTo}
                    />
                    <button>
                      Mark read
                    </button>
                  </form>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              Delivery outbox
            </p>
            <h2>Recent deliveries</h2>
          </div>
          <span className="metric">
            {deliveries.length}
          </span>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Channel</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Created</th>
                <th>Last error</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((delivery) => (
                <tr key={delivery.id}>
                  <td>{delivery.channel}</td>
                  <td>{delivery.status}</td>
                  <td>{delivery.attempts}</td>
                  <td>
                    {formatDateTime(
                      delivery.createdAt,
                    )}
                  </td>
                  <td>
                    {delivery.lastError ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AdminShell>
  );
}
