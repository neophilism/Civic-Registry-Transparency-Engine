import Link from "next/link";
import { notFound } from "next/navigation";
import {
  PostgresIngestionService,
} from "@civic-registry/database";

import { AdminShell } from "../../../../components/admin-shell";
import {
  createAdminSource,
  decideAdminTransition,
  reconcileAdminDeadlines,
} from "../../actions";
import {
  requireAdminSession,
} from "../../../../lib/admin-auth";
import {
  getAdminDeadlineLabel,
  getAdminRecordTitle,
  getAdminRegistry,
  getAdminStatusLabel,
  validateInstalledConfig,
} from "../../../../lib/admin-console";
import {
  getDatabasePool,
  getRepositories,
} from "../../../../lib/database";
import { formatDateTime } from "../../../../lib/format";

export const dynamic = "force-dynamic";

interface RegistryAdminPageProps {
  params: Promise<{
    registryId: string;
  }>;
  searchParams: Promise<{
    notice?: string;
    error?: string;
  }>;
}

export default async function RegistryAdminPage({
  params,
  searchParams,
}: RegistryAdminPageProps) {
  const session = await requireAdminSession();
  const { registryId } = await params;
  const query = await searchParams;
  const registry =
    await getAdminRegistry(registryId);

  if (!registry) notFound();

  const repositories = getRepositories();
  const ingestion =
    new PostgresIngestionService(
      getDatabasePool(),
    );
  const [
    records,
    pendingRequests,
    deadlines,
    runs,
    sources,
  ] = await Promise.all([
    repositories.records.list(registryId, {
      limit: 25,
    }),
    repositories.admin.listTransitionRequests(
      registryId,
      {
        status: "pending",
        limit: 25,
      },
    ),
    repositories.admin.listDeadlines(
      registryId,
      {
        states: ["open", "paused"],
        limit: 25,
      },
    ),
    ingestion.listRuns(registryId, {
      limit: 15,
    }),
    repositories.sources.list(registryId, {
      limit: 25,
    }),
  ]);
  const failedItems = (
    await Promise.all(
      runs.slice(0, 8).map(async (run) => ({
        run,
        items: await ingestion.listItems(
          registryId,
          run.id,
          {
            outcome: "failed",
            limit: 10,
          },
        ),
      })),
    )
  ).filter((entry) => entry.items.length > 0);
  const configIssues =
    validateInstalledConfig(
      registry.configFile,
    );
  const returnTo =
    "/admin/registries/" +
    encodeURIComponent(registryId);

  return (
    <AdminShell
      session={session}
      registryId={registryId}
      title={registry.config.definition.name}
      subtitle="Internal operational view. Public disclosure rules do not limit this console, so access must remain restricted to authorized operators."
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
            {registry.summary.recordCount}
          </strong>
          <span>Records</span>
        </div>
        <div>
          <strong>
            {
              registry.summary
                .pendingApprovalCount
            }
          </strong>
          <span>Pending approvals</span>
        </div>
        <div>
          <strong>
            {
              registry.summary
                .failedIngestionItemCount
            }
          </strong>
          <span>Failed ingestion items</span>
        </div>
        <div>
          <strong>
            {
              registry.summary
                .overdueDeadlineCount
            }
          </strong>
          <span>Overdue deadlines</span>
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              Record management
            </p>
            <h2>Canonical records</h2>
          </div>
          <div className="section-actions">
            {registry.config.definition.recordTypes.map(
              (recordType) => (
                <Link
                  key={recordType.id}
                  href={
                    returnTo +
                    "/records/new?type=" +
                    encodeURIComponent(
                      recordType.id,
                    )
                  }
                >
                  New {recordType.name}
                </Link>
              ),
            )}
          </div>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Record</th>
                <th>Type</th>
                <th>Status</th>
                <th>Visibility</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id}>
                  <td>
                    <Link
                      href={
                        returnTo +
                        "/records/" +
                        encodeURIComponent(
                          record.id,
                        )
                      }
                    >
                      {getAdminRecordTitle(
                        registry.config,
                        record,
                      )}
                    </Link>
                    <small className="mono">
                      {record.id}
                    </small>
                  </td>
                  <td>
                    {
                      registry.config.getRecordType(
                        record.recordTypeId,
                      ).definition.name
                    }
                  </td>
                  <td>
                    {getAdminStatusLabel(
                      registry.config,
                      record.status,
                    )}
                  </td>
                  <td>{record.visibility}</td>
                  <td>
                    {formatDateTime(
                      record.updatedAt,
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section
        className="section-block"
        id="approvals"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              Publication workflow
            </p>
            <h2>Pending approvals</h2>
          </div>
          <span className="metric">
            {pendingRequests.length}
          </span>
        </div>

        {pendingRequests.length === 0 ? (
          <div className="empty-state empty-state--inline">
            No lifecycle approval requests are pending.
          </div>
        ) : (
          <div className="admin-stack">
            {pendingRequests.map((request) => (
              <article
                className="admin-card"
                key={request.id}
              >
                <div>
                  <strong>
                    {request.recordId}
                  </strong>
                  <span>
                    {getAdminStatusLabel(
                      registry.config,
                      request.fromStatusId,
                    )}{" "}
                    →{" "}
                    {getAdminStatusLabel(
                      registry.config,
                      request.toStatusId,
                    )}
                  </span>
                  <small>
                    Requested{" "}
                    {formatDateTime(
                      request.requestedAt,
                    )}
                    {request.requestedBy
                      ? " by " +
                        request.requestedBy
                      : ""}
                  </small>
                </div>
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
                  <input
                    name="note"
                    placeholder="Decision note"
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
              </article>
            ))}
          </div>
        )}
      </section>

      <section
        className="section-block"
        id="deadlines"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              Deadline engine
            </p>
            <h2>Open obligations</h2>
          </div>
          <form
            action={reconcileAdminDeadlines}
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
            <button className="button-link">
              Reconcile
            </button>
          </form>
        </div>
        <div className="admin-stack">
          {deadlines.map((deadline) => {
            const overdue =
              deadline.state === "open" &&
              new Date(deadline.dueAt) <
                new Date();
            return (
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
                    Record {deadline.recordId}
                  </span>
                  <small>
                    Due{" "}
                    {formatDateTime(
                      deadline.dueAt,
                    )}{" "}
                    · {deadline.state}
                    {overdue ? " · OVERDUE" : ""}
                  </small>
                </div>
                <Link
                  href={
                    returnTo +
                    "/records/" +
                    encodeURIComponent(
                      deadline.recordId,
                    )
                  }
                >
                  Open record
                </Link>
              </article>
            );
          })}
        </div>
      </section>

      <section
        className="section-block"
        id="ingestion"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              Ingestion
            </p>
            <h2>Recent runs and failures</h2>
          </div>
          <span className="metric">
            {runs.length} recent runs
          </span>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Status</th>
                <th>Mode</th>
                <th>Items</th>
                <th>Failed</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>
                    {run.sourceLabel}
                    <small className="mono">
                      {run.id}
                    </small>
                  </td>
                  <td>{run.status}</td>
                  <td>
                    {run.dryRun
                      ? "dry run"
                      : run.mode}
                  </td>
                  <td>{run.totalItems}</td>
                  <td>{run.failedItems}</td>
                  <td>
                    {formatDateTime(
                      run.startedAt,
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {failedItems.map(({ run, items }) => (
          <details
            className="admin-details"
            key={run.id}
          >
            <summary>
              {run.sourceLabel}:{" "}
              {items.length} shown failures
            </summary>
            <ul>
              {items.map((item) => (
                <li key={item.id}>
                  <strong>
                    {item.errorCode ??
                      "ingestion_error"}
                  </strong>
                  <span>
                    {item.errorMessage ??
                      "No error message"}
                  </span>
                  <small>
                    {item.sourceKey
                      ? "Source key: " +
                        item.sourceKey
                      : ""}
                    {item.lineNumber
                      ? " · line " +
                        item.lineNumber
                      : ""}
                  </small>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </section>

      <section
        className="section-block"
        id="sources"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              Evidence inputs
            </p>
            <h2>Sources</h2>
          </div>
          <span className="metric">
            {sources.length} shown
          </span>
        </div>

        <div className="admin-two-column">
          <div className="admin-stack">
            {sources.map((source) => (
              <article
                className="admin-card"
                key={source.id}
              >
                <div>
                  <strong>
                    {source.title}
                  </strong>
                  <span>
                    {source.sourceType} ·{" "}
                    {source.visibility}
                  </span>
                  <small className="mono">
                    {source.id}
                  </small>
                </div>
                {source.canonicalUrl ? (
                  <a
                    href={source.canonicalUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open source
                  </a>
                ) : null}
              </article>
            ))}
          </div>

          <form
            className="admin-form admin-card"
            action={createAdminSource}
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
            <h3>Add source</h3>
            <label>
              <span>Title</span>
              <input name="title" required />
            </label>
            <label>
              <span>Type</span>
              <select
                name="sourceType"
                defaultValue="webpage"
              >
                <option value="webpage">
                  Webpage
                </option>
                <option value="document">
                  Document
                </option>
                <option value="dataset">
                  Dataset
                </option>
                <option value="api">API</option>
                <option value="feed">
                  Feed
                </option>
                <option value="other">
                  Other
                </option>
              </select>
            </label>
            <label>
              <span>Visibility</span>
              <select
                name="visibility"
                defaultValue="private"
              >
                <option value="public">
                  Public
                </option>
                <option value="restricted">
                  Restricted
                </option>
                <option value="private">
                  Private
                </option>
                <option value="embargoed">
                  Embargoed
                </option>
              </select>
            </label>
            <label>
              <span>Canonical URL</span>
              <input
                type="url"
                name="canonicalUrl"
              />
            </label>
            <label>
              <span>Description</span>
              <textarea
                name="description"
                rows={4}
              />
            </label>
            <label>
              <span>Audit reason</span>
              <input name="reason" />
            </label>
            <div className="admin-actions">
              <button type="submit">
                Add source
              </button>
            </div>
          </form>
        </div>
      </section>

      <section
        className="section-block"
        id="configuration"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              Configuration health
            </p>
            <h2>Schema validation</h2>
          </div>
          <span className="metric">
            {configIssues.length === 0
              ? "valid"
              : configIssues.length +
                " issues"}
          </span>
        </div>

        {configIssues.length === 0 ? (
          <div className="admin-message">
            Installed configuration passes the
            engine validator.
          </div>
        ) : (
          <div className="admin-stack">
            {configIssues.map(
              (issue, index) => (
                <article
                  className="admin-card"
                  key={
                    issue.path +
                    issue.code +
                    index
                  }
                >
                  <div>
                    <strong>
                      {issue.code}
                    </strong>
                    <span>{issue.message}</span>
                    <small className="mono">
                      {issue.path}
                    </small>
                  </div>
                </article>
              ),
            )}
          </div>
        )}
      </section>
    </AdminShell>
  );
}
