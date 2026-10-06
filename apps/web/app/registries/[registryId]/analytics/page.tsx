import Link from "next/link";
import { notFound } from "next/navigation";

import { Breadcrumbs } from "../../../../components/breadcrumbs";
import {
  analyticsDimensionCandidates,
  getPublicAnalytics,
} from "../../../../lib/analytics";
import {
  getPublicRegistry,
} from "../../../../lib/public-registry";

export const dynamic = "force-dynamic";

interface AnalyticsPageProps {
  params: Promise<{ registryId: string }>;
  searchParams: Promise<{
    dimension?: string;
  }>;
}

function labelFor(
  entries: Array<{ key: string; count: number }>,
  labels: Map<string, string>,
) {
  return entries.map((entry) => ({
    ...entry,
    label: labels.get(entry.key) ?? entry.key,
  }));
}

export default async function RegistryAnalyticsPage({
  params,
  searchParams,
}: AnalyticsPageProps) {
  const { registryId } = await params;
  const query = await searchParams;
  const registry =
    await getPublicRegistry(registryId);

  if (!registry) notFound();

  const candidates =
    analyticsDimensionCandidates(registry.config);
  const selected = candidates.find(
    (candidate) =>
      candidate.recordTypeId + ":" + candidate.fieldId ===
      query.dimension,
  );
  const analytics = await getPublicAnalytics(
    registry.config,
    selected
      ? {
          recordTypeId: selected.recordTypeId,
          fieldId: selected.fieldId,
        }
      : undefined,
  );

  const recordTypeLabels = new Map(
    registry.config.definition.recordTypes.map(
      (type) => [type.id, type.name],
    ),
  );
  const statusLabels = new Map(
    registry.config.publicationLifecycle
      ? [
          ...registry.config.publicationLifecycle.statusesById.values(),
        ].map((status) => [status.id, status.label])
      : analytics.statuses.map((status) => [
          status.key,
          status.key,
        ]),
  );

  return (
    <main className="page-shell">
      <Breadcrumbs
        items={[
          { label: "Registries", href: "/" },
          {
            label: registry.config.definition.name,
            href:
              "/registries/" +
              encodeURIComponent(registryId),
          },
          { label: "Analytics" },
        ]}
      />

      <header className="page-heading page-heading--compact">
        <p className="eyebrow">Public analytics</p>
        <h1>Registry activity</h1>
        <p className="lede">
          Aggregate statistics computed only from records and
          fields that are currently eligible for public
          disclosure.
        </p>
      </header>

      <section className="analytics-metrics">
        <div>
          <strong>{analytics.totals.records}</strong>
          <span>Public records</span>
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
          <span>Overdue public deadlines</span>
        </div>
      </section>

      <section className="section-block analytics-grid">
        <article className="analytics-panel">
          <p className="eyebrow">Composition</p>
          <h2>Records by type</h2>
          <div className="analytics-bars">
            {labelFor(
              analytics.recordTypes,
              recordTypeLabels,
            ).map((entry) => (
              <div key={entry.key}>
                <span>{entry.label}</span>
                <strong>{entry.count}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="analytics-panel">
          <p className="eyebrow">Lifecycle</p>
          <h2>Status distribution</h2>
          <div className="analytics-bars">
            {labelFor(
              analytics.statuses,
              statusLabels,
            ).map((entry) => (
              <div key={entry.key}>
                <span>{entry.label}</span>
                <strong>{entry.count}</strong>
              </div>
            ))}
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
          <p className="eyebrow">Change history</p>
          <h2>Public record activity</h2>
          <div className="analytics-bars">
            {analytics.changeActivity.length === 0 ? (
              <p>No public record activity in this period.</p>
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
            <h2>Configured field breakdown</h2>
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
                    <p>
                      No disclosed values are available for this
                      dimension.
                    </p>
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
    </main>
  );
}
