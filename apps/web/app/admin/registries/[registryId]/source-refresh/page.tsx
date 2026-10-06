import { notFound } from "next/navigation";

import { AdminShell } from "../../../../../components/admin-shell";
import {
  queueAdminSourceRefreshNow,
  setAdminSourceRefreshEnabled,
} from "../../../actions";
import {
  requireAdminSession,
} from "../../../../../lib/admin-auth";
import {
  getAdminRegistry,
} from "../../../../../lib/admin-console";
import {
  getRepositories,
} from "../../../../../lib/database";
import { formatDateTime } from "../../../../../lib/format";

export const dynamic = "force-dynamic";

interface SourceRefreshAdminPageProps {
  params: Promise<{ registryId: string }>;
  searchParams: Promise<{
    notice?: string;
    error?: string;
  }>;
}

function healthLabel(
  status:
    | "disabled"
    | "never_run"
    | "running"
    | "healthy"
    | "warning"
    | "failing"
    | "stale",
): string {
  switch (status) {
    case "disabled":
      return "Disabled";
    case "never_run":
      return "Never run";
    case "running":
      return "Running";
    case "healthy":
      return "Healthy";
    case "warning":
      return "Warning";
    case "failing":
      return "Failing";
    case "stale":
      return "Stale";
  }
}

export default async function SourceRefreshAdminPage({
  params,
  searchParams,
}: SourceRefreshAdminPageProps) {
  const session = await requireAdminSession();
  const { registryId } = await params;
  const query = await searchParams;
  const registry =
    await getAdminRegistry(registryId);

  if (!registry) notFound();

  const service =
    getRepositories().sourceRefresh;
  const [health, runs] =
    await Promise.all([
      service.listHealth(registryId),
      service.listRuns(registryId, {
        limit: 50,
      }),
    ]);
  const returnTo =
    "/admin/registries/" +
    encodeURIComponent(registryId) +
    "/source-refresh";
  const unhealthy =
    health.filter(
      (item) =>
        item.status === "warning" ||
        item.status === "failing" ||
        item.status === "stale",
    ).length;
  const running =
    health.filter(
      (item) =>
        item.status === "running",
    ).length;

  return (
    <AdminShell
      session={session}
      registryId={registryId}
      title="Source refresh"
      subtitle="Monitor scheduled public-source adapters and queue work for the external refresh worker. The administrator web process never fetches remote source sites."
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
          <strong>{health.length}</strong>
          <span>Refresh jobs</span>
        </div>
        <div>
          <strong>
            {
              health.filter(
                (item) =>
                  item.status ===
                  "healthy",
              ).length
            }
          </strong>
          <span>Healthy</span>
        </div>
        <div>
          <strong>{unhealthy}</strong>
          <span>Need attention</span>
        </div>
        <div>
          <strong>{running}</strong>
          <span>Running</span>
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              Scheduler
            </p>
            <h2>Configured refresh jobs</h2>
          </div>
          <span className="metric">
            {health.length} jobs
          </span>
        </div>

        {health.length === 0 ? (
          <div className="empty-state empty-state--inline">
            No source refresh definitions have
            been synchronized for this registry.
          </div>
        ) : (
          <div className="admin-stack">
            {health.map((item) => {
              const job = item.job;

              return (
                <article
                  className="admin-card"
                  key={job.id}
                >
                  <div>
                    <strong>
                      {job.label}
                    </strong>
                    <span>
                      {healthLabel(
                        item.status,
                      )}{" "}
                      · {job.adapterId}
                    </span>
                    <small>
                      {item.reason}
                    </small>
                    <small>
                      Next{" "}
                      {formatDateTime(
                        job.nextRunAt,
                      )}
                      {job.lastCompletedAt
                        ? " · Last " +
                          formatDateTime(
                            job.lastCompletedAt,
                          )
                        : ""}
                    </small>
                    <small>
                      Rows{" "}
                      {job.lastRowCount ??
                        "—"}
                      {" · "}
                      Warnings{" "}
                      {job.lastWarningCount ??
                        "—"}
                      {" · "}
                      Failures{" "}
                      {
                        job.consecutiveFailures
                      }
                    </small>
                    {job.lastOutputSha256 ? (
                      <small className="mono">
                        SHA-256{" "}
                        {
                          job.lastOutputSha256
                        }
                      </small>
                    ) : null}
                    {job.lastIngestionRunId ? (
                      <small className="mono">
                        Ingestion{" "}
                        {
                          job.lastIngestionRunId
                        }
                      </small>
                    ) : null}
                    {job.lastError ? (
                      <small>
                        Last error:{" "}
                        {job.lastError}
                      </small>
                    ) : null}
                  </div>

                  <div className="admin-actions">
                    <form
                      action={
                        queueAdminSourceRefreshNow
                      }
                    >
                      <input
                        type="hidden"
                        name="registryId"
                        value={registryId}
                      />
                      <input
                        type="hidden"
                        name="jobId"
                        value={job.id}
                      />
                      <input
                        type="hidden"
                        name="returnTo"
                        value={returnTo}
                      />
                      <button
                        disabled={
                          !job.enabled ||
                          item.status ===
                            "running"
                        }
                      >
                        Queue now
                      </button>
                    </form>

                    <form
                      action={
                        setAdminSourceRefreshEnabled
                      }
                    >
                      <input
                        type="hidden"
                        name="registryId"
                        value={registryId}
                      />
                      <input
                        type="hidden"
                        name="jobId"
                        value={job.id}
                      />
                      <input
                        type="hidden"
                        name="enabled"
                        value={
                          job.enabled
                            ? "false"
                            : "true"
                        }
                      />
                      <input
                        type="hidden"
                        name="returnTo"
                        value={returnTo}
                      />
                      <button className="admin-button--quiet">
                        {job.enabled
                          ? "Disable"
                          : "Enable"}
                      </button>
                    </form>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <p className="lede">
          Production deployments should invoke{" "}
          <code>
            pnpm
            source:refresh-open-legal-interpretations
          </code>{" "}
          from a recurring worker or cron service.
          Database leases prevent overlapping
          workers from claiming the same job.
        </p>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              Run history
            </p>
            <h2>Recent source refreshes</h2>
          </div>
          <span className="metric">
            {runs.length} shown
          </span>
        </div>

        {runs.length === 0 ? (
          <div className="empty-state empty-state--inline">
            No source refresh run has been
            recorded yet.
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Status</th>
                  <th>Rows</th>
                  <th>Delta</th>
                  <th>Warnings</th>
                  <th>Ingestion</th>
                  <th>Started</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>
                      {run.jobId}
                      <small className="mono">
                        {run.adapterId}
                      </small>
                    </td>
                    <td>
                      {run.status}
                      {run.errorMessage ? (
                        <small>
                          {run.errorMessage}
                        </small>
                      ) : null}
                    </td>
                    <td>
                      {run.rowCount ?? "—"}
                    </td>
                    <td>
                      {run.rowCountDelta ===
                      undefined
                        ? "—"
                        : run.rowCountDelta}
                    </td>
                    <td>
                      {run.warningCount ??
                        "—"}
                      {run.warnings.length >
                      0 ? (
                        <small>
                          {run.warnings
                            .map(
                              (warning) =>
                                warning.code,
                            )
                            .join(", ")}
                        </small>
                      ) : null}
                    </td>
                    <td>
                      {run.ingestionStatus ??
                        "—"}
                      {run.ingestionRunId ? (
                        <small className="mono">
                          {
                            run.ingestionRunId
                          }
                        </small>
                      ) : null}
                    </td>
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
        )}
      </section>
    </AdminShell>
  );
}
