import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminRecordForm } from "../../../../../../components/admin-record-form";
import { AdminShell } from "../../../../../../components/admin-shell";
import {
  decideAdminTransition,
  requestAdminTransition,
  transitionAdminDeadline,
  updateAdminRecord,
} from "../../../../actions";
import {
  requireAdminSession,
} from "../../../../../../lib/admin-auth";
import {
  getAdminDeadlineLabel,
  getAdminRecordTitle,
  getAdminRegistry,
  getAdminStatusLabel,
} from "../../../../../../lib/admin-console";
import {
  getRepositories,
} from "../../../../../../lib/database";
import {
  formatDateTime,
} from "../../../../../../lib/format";

export const dynamic = "force-dynamic";

interface RecordAdminPageProps {
  params: Promise<{
    registryId: string;
    recordId: string;
  }>;
  searchParams: Promise<{
    notice?: string;
    error?: string;
  }>;
}

export default async function RecordAdminPage({
  params,
  searchParams,
}: RecordAdminPageProps) {
  const session = await requireAdminSession();
  const { registryId, recordId } =
    await params;
  const query = await searchParams;
  const registry =
    await getAdminRegistry(registryId);

  if (!registry) notFound();

  const repositories = getRepositories();
  const record = await repositories.records.get(
    registryId,
    recordId,
  );

  if (!record) notFound();

  const recordType =
    registry.config.getRecordType(
      record.recordTypeId,
    );
  const [
    versions,
    events,
    deadlines,
    requests,
    evidence,
  ] = await Promise.all([
    repositories.history.listVersions(
      registryId,
      recordId,
      { limit: 25 },
    ),
    repositories.history.listEvents(
      registryId,
      recordId,
      { limit: 50 },
    ),
    repositories.deadlines.listForRecord(
      registryId,
      recordId,
      { limit: 50 },
    ),
    repositories.admin.listTransitionRequests(
      registryId,
      {
        recordId,
        limit: 25,
      },
    ),
    repositories.citations.listEvidenceForRecord(
      registryId,
      recordId,
      { limit: 50 },
    ),
  ]);
  const currentTransitions =
    registry.config.publicationLifecycle
      ?.transitionsFromStatus.get(
        record.status,
      ) ?? [];
  const returnTo =
    "/admin/registries/" +
    encodeURIComponent(registryId) +
    "/records/" +
    encodeURIComponent(recordId);

  return (
    <AdminShell
      session={session}
      registryId={registryId}
      title={getAdminRecordTitle(
        registry.config,
        record,
      )}
      subtitle={"Record " + record.id}
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
          <strong>
            {getAdminStatusLabel(
              registry.config,
              record.status,
            )}
          </strong>
          <span>Status</span>
        </div>
        <div>
          <strong>{record.visibility}</strong>
          <span>Visibility</span>
        </div>
        <div>
          <strong>{versions.length}</strong>
          <span>Recent revisions</span>
        </div>
        <div>
          <strong>{evidence.length}</strong>
          <span>Evidence links</span>
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              Canonical data
            </p>
            <h2>Edit record</h2>
          </div>
          <Link
            href={
              "/registries/" +
              encodeURIComponent(
                registryId,
              ) +
              "/records/" +
              encodeURIComponent(recordId)
            }
          >
            Public view
          </Link>
        </div>
        <AdminRecordForm
          registryId={registryId}
          recordType={recordType}
          record={record}
          action={updateAdminRecord}
          returnTo={returnTo}
          submitLabel="Save changes"
        />
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              Publication workflow
            </p>
            <h2>Lifecycle</h2>
          </div>
          <span className="metric">
            {getAdminStatusLabel(
              registry.config,
              record.status,
            )}
          </span>
        </div>

        <div className="admin-two-column">
          <div className="admin-stack">
            {currentTransitions.map(
              (transition) => (
                <form
                  className="admin-card admin-form"
                  action={
                    requestAdminTransition
                  }
                  key={
                    transition.fromStatusId +
                    transition.toStatusId
                  }
                >
                  <input
                    type="hidden"
                    name="registryId"
                    value={registryId}
                  />
                  <input
                    type="hidden"
                    name="recordId"
                    value={recordId}
                  />
                  <input
                    type="hidden"
                    name="toStatusId"
                    value={
                      transition.toStatusId
                    }
                  />
                  <input
                    type="hidden"
                    name="returnTo"
                    value={returnTo}
                  />
                  <div>
                    <strong>
                      {transition.label ??
                        "Move to " +
                          getAdminStatusLabel(
                            registry.config,
                            transition.toStatusId,
                          )}
                    </strong>
                    <span>
                      Allowed roles:{" "}
                      {transition.allowedRoles
                        ?.join(", ") ??
                        "unrestricted"}
                    </span>
                    {transition.approval ? (
                      <small>
                        Requires{" "}
                        {transition.approval
                          .minApprovals ?? 1}{" "}
                        approval(s).
                      </small>
                    ) : null}
                  </div>
                  <label>
                    <span>Reason</span>
                    <input name="reason" />
                  </label>
                  <div className="admin-actions">
                    <button type="submit">
                      Execute / request
                    </button>
                  </div>
                </form>
              ),
            )}
          </div>

          <div className="admin-stack">
            {requests.map((request) => (
              <article
                className="admin-card"
                key={request.id}
              >
                <div>
                  <strong>
                    {getAdminStatusLabel(
                      registry.config,
                      request.fromStatusId,
                    )}{" "}
                    →{" "}
                    {getAdminStatusLabel(
                      registry.config,
                      request.toStatusId,
                    )}
                  </strong>
                  <span>
                    Request: {request.status}
                  </span>
                  <small>
                    {formatDateTime(
                      request.requestedAt,
                    )}
                  </small>
                </div>
                {request.status === "pending" ? (
                  <form
                    className="admin-inline-form"
                    action={
                      decideAdminTransition
                    }
                  >
                    <input
                      type="hidden"
                      name="registryId"
                      value={registryId}
                    />
                    <input
                      type="hidden"
                      name="requestId"
                      value={request.id}
                    />
                    <input
                      type="hidden"
                      name="returnTo"
                      value={returnTo}
                    />
                    <button
                      name="decision"
                      value="approved"
                    >
                      Approve
                    </button>
                    <button
                      className="admin-button--quiet"
                      name="decision"
                      value="rejected"
                    >
                      Reject
                    </button>
                  </form>
                ) : null}
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              Deadline engine
            </p>
            <h2>Record deadlines</h2>
          </div>
          <span className="metric">
            {deadlines.length}
          </span>
        </div>
        <div className="admin-stack">
          {deadlines.map((deadline) => (
            <article
              className="admin-card"
              key={deadline.id}
            >
              <div>
                <strong>
                  {getAdminDeadlineLabel(
                    registry.config,
                    deadline.deadlineTypeId,
                  )}
                </strong>
                <span>
                  Due{" "}
                  {formatDateTime(
                    deadline.dueAt,
                  )}
                </span>
                <small>
                  {deadline.state} ·{" "}
                  {deadline.instanceKey}
                </small>
              </div>
              {deadline.state === "open" ||
              deadline.state === "paused" ? (
                <form
                  className="admin-inline-form"
                  action={
                    transitionAdminDeadline
                  }
                >
                  <input
                    type="hidden"
                    name="registryId"
                    value={registryId}
                  />
                  <input
                    type="hidden"
                    name="deadlineId"
                    value={deadline.id}
                  />
                  <input
                    type="hidden"
                    name="returnTo"
                    value={returnTo}
                  />
                  {deadline.state === "open" ? (
                    <button
                      name="deadlineAction"
                      value="pause"
                    >
                      Pause
                    </button>
                  ) : (
                    <button
                      name="deadlineAction"
                      value="resume"
                    >
                      Resume
                    </button>
                  )}
                  <button
                    name="deadlineAction"
                    value="complete"
                  >
                    Complete
                  </button>
                  <button
                    className="admin-button--quiet"
                    name="deadlineAction"
                    value="cancel"
                  >
                    Cancel
                  </button>
                </form>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              Immutable history
            </p>
            <h2>Audit trail</h2>
          </div>
          <span className="metric">
            {events.length} events
          </span>
        </div>

        <div className="admin-two-column">
          <div>
            <h3>Events</h3>
            <div className="admin-stack">
              {events.map((event) => (
                <article
                  className="admin-card"
                  key={event.id}
                >
                  <div>
                    <strong>
                      {event.eventType}
                    </strong>
                    <span>
                      {formatDateTime(
                        event.occurredAt,
                      )}
                    </span>
                    <small>
                      {event.actorId
                        ? "Actor: " +
                          event.actorId
                        : "System / unattributed"}
                      {event.reason
                        ? " · " + event.reason
                        : ""}
                    </small>
                  </div>
                </article>
              ))}
            </div>
          </div>
          <div>
            <h3>Revisions</h3>
            <div className="admin-stack">
              {versions.map((version) => (
                <article
                  className="admin-card"
                  key={version.id}
                >
                  <div>
                    <strong>
                      Version {version.version} ·{" "}
                      {version.operation}
                    </strong>
                    <span>
                      {formatDateTime(
                        version.createdAt,
                      )}
                    </span>
                    <small>
                      {version.actorId
                        ? "Actor: " +
                          version.actorId
                        : "System / unattributed"}
                    </small>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>
    </AdminShell>
  );
}
