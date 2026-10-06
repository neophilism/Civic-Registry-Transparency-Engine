import Link from "next/link";

import { AdminShell } from "../../components/admin-shell";
import {
  requireAdminSession,
} from "../../lib/admin-auth";
import {
  listAdminRegistries,
} from "../../lib/admin-console";

export const dynamic = "force-dynamic";

interface AdminPageProps {
  searchParams: Promise<{
    notice?: string;
    error?: string;
  }>;
}

export default async function AdminPage({
  searchParams,
}: AdminPageProps) {
  const session = await requireAdminSession();
  const [registries, query] =
    await Promise.all([
      listAdminRegistries(),
      searchParams,
    ]);

  return (
    <AdminShell
      session={session}
      title="Registry operations"
      subtitle="Review internal state, publication queues, ingestion failures, deadlines, and configuration health across installed registries."
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

      <section className="section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              Installed registries
            </p>
            <h2>Operational overview</h2>
          </div>
          <span className="metric">
            {registries.length} registries
          </span>
        </div>

        <div className="admin-registry-grid">
          {registries.map(
            ({ config, summary }) => (
              <Link
                className="admin-registry-card"
                key={config.definition.id}
                href={
                  "/admin/registries/" +
                  encodeURIComponent(
                    config.definition.id,
                  )
                }
              >
                <div>
                  <span>
                    {config.definition.name}
                  </span>
                  <strong>
                    {summary.recordCount}
                  </strong>
                  <small>records</small>
                </div>
                <dl>
                  <div>
                    <dt>Pending approvals</dt>
                    <dd>
                      {
                        summary.pendingApprovalCount
                      }
                    </dd>
                  </div>
                  <div>
                    <dt>Failed ingestion items</dt>
                    <dd>
                      {
                        summary.failedIngestionItemCount
                      }
                    </dd>
                  </div>
                  <div>
                    <dt>Overdue deadlines</dt>
                    <dd>
                      {
                        summary.overdueDeadlineCount
                      }
                    </dd>
                  </div>
                  <div>
                    <dt>Sources</dt>
                    <dd>{summary.sourceCount}</dd>
                  </div>
                </dl>
              </Link>
            ),
          )}
        </div>
      </section>
    </AdminShell>
  );
}
