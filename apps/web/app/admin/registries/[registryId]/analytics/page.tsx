import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminShell } from "../../../../../../components/admin-shell";
import {
  analyticsDimensionCandidates,
  getAdminAnalytics,
} from "../../../../../../lib/analytics";
import {
  requireAdminSession,
} from "../../../../../../lib/admin-auth";
import {
  getAdminRegistry,
} from "../../../../../../lib/admin-console";

export const dynamic = "force-dynamic";

interface AdminAnalyticsPageProps {
  params: Promise<{ registryId: string }>;
  searchParams: Promise<{ dimension?: string }>;
}

export default async function AdminAnalyticsPage({
  params,
  searchParams,
}: AdminAnalyticsPageProps) {
  const session = await requireAdminSession();
  const { registryId } = await params;
  const query = await searchParams;
  const registry = await getAdminRegistry(registryId);

  if (!registry) notFound();

  const candidates =
    analyticsDimensionCandidates(registry.config);
  const selected = candidates.find(
    (candidate) =>
      candidate.recordTypeId + ":" + candidate.fieldId ===
      query.dimension,
  );
  const analytics = await getAdminAnalytics(
    registry.config,
    selected
      ? {
          recordTypeId: selected.recordTypeId,
          fieldId: selected.fieldId,
        }
      : undefined,
  );

  return (
    <AdminShell
      session={session}
      registryId={registryId}
      title="Registry analytics"
      subtitle="Internal aggregate view across canonical records, publication workflow, deadlines, immutable change history, and evidence coverage."
    >
      <section className="analytics-metrics">
        <div>
          <strong>{analytics.totals.records}</strong>
          <span>Canonical records</span>
        </div>
        <div>
          <strong>{analytics.totals.published}</strong>
          <span>Ever published</span>
        </div>
        <div>
          <strong>
            {analytics.totals.evidenceCoveragePercent}%
          </strong>
          <span>Evidence coverage</span>
        </div>
        <div>
          <strong>{analytics.deadlines.overdue}</strong>
          <span>Overdue deadlines</span>
        </div>
      </section>

      <section className="section-block analytics-grid">
        <article className="analytics-panel">
          <p className="eyebrow">Deadlines</p>
          <h2>Operational obligations</h2>
          <div className="analytics-bars">
            <div>
              <span>Open</span>
              <strong>{analytics.deadlines.open}</strong>
            </div>
            <div>
              <span>Due within 30 days</span>
              <strong>{analytics.deadlines.dueSoon}</strong>
            </div>
            <div>
              <span>Overdue</span>
              <strong>{analytics.deadlines.overdue}</strong>
            </div>
          </div>
        </article>

        <article className="analytics-panel">
          <p className="eyebrow">Evidence</p>
          <h2>Source coverage</h2>
          <div className="analytics-bars">
            <div>
              <span>Records with citations</span>
              <strong>
                {analytics.totals.citedRecords}
              </strong>
            </div>
            <div>
              <span>Coverage</span>
              <strong>
                {analytics.totals.evidenceCoveragePercent}%
              </strong>
            </div>
          </div>
        </article>

        <article className="analytics-panel">
          <p className="eyebrow">Publication</p>
          <h2>Monthly publications</h2>
          <div className="analytics-bars">
            {analytics.publicationTrend.length === 0 ? (
              <p>No publication activity in this period.</p>
            ) : (
              analytics.publicationTrend.map((entry) => (
                <div key={entry.period}>
                  <span>{entry.period}</span>
                  <strong>{entry.count}</strong>
                </div>
              ))
            )}
          </div>
        </article>

        <article className="analytics-panel">
          <p className="eyebrow">Audit activity</p>
          <h2>Record changes</h2>
          <div className="analytics-bars">
            {analytics.changeActivity.length === 0 ? (
              <p>No record activity in this period.</p>
            ) : (
              analytics.changeActivity.map((entry) => (
                <div key={entry.period}>
                  <span>{entry.period}</span>
                  <strong>{entry.count}</strong>
                </div>
              ))
            )}
          </div>
        </article>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Dimensions</p>
            <h2>Field breakdowns</h2>
          </div>
        </div>

        {candidates.length === 0 ? (
          <div className="empty-state empty-state--inline">
            This registry does not configure any filterable
            fields for dimensional analytics.
          </div>
        ) : (
          <>
            <nav className="record-type-nav">
              {candidates.map((candidate) => {
                const value =
                  candidate.recordTypeId +
                  ":" +
                  candidate.fieldId;
                return (
                  <Link
                    key={value}
                    href={
                      "?dimension=" +
                      encodeURIComponent(value)
                    }
                  >
                    {candidate.label}
                  </Link>
                );
              })}
            </nav>

            {selected && analytics.dimension ? (
              <article className="analytics-panel analytics-panel--wide">
                <h3>{selected.label}</h3>
                <div className="analytics-bars">
                  {analytics.dimension.values.length === 0 ? (
                    <p>No values are available for this dimension.</p>
                  ) : (
                    analytics.dimension.values.map(
                      (entry) => (
                        <div key={entry.key}>
                          <span>{entry.key}</span>
                          <strong>{entry.count}</strong>
                        </div>
                      ),
                    )
                  )}
                </div>
              </article>
            ) : null}
          </>
        )}
      </section>
    </AdminShell>
  );
}
