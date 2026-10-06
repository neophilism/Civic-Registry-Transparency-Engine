import type {
  AnalyticsCount,
  AnalyticsTimeBucket,
  RegistryAnalyticsSnapshot,
} from "@civic-registry/analytics";

interface AnalyticsDashboardProps {
  snapshot: RegistryAnalyticsSnapshot;
}

function maxCount(
  items: Array<{ count: number }>,
): number {
  return Math.max(1, ...items.map((item) => item.count));
}

function CountList({
  items,
}: {
  items: AnalyticsCount[];
}) {
  const maximum = maxCount(items);

  if (items.length === 0) {
    return (
      <div className="empty-state empty-state--inline">
        No data is available for this breakdown.
      </div>
    );
  }

  return (
    <div className="analytics-bars">
      {items.map((item) => (
        <div className="analytics-bar" key={item.id}>
          <div>
            <strong>{item.label}</strong>
            <span>{item.count}</span>
          </div>
          <progress
            max={maximum}
            value={item.count}
            aria-label={item.label}
          />
        </div>
      ))}
    </div>
  );
}

function Trend({
  items,
  emptyLabel,
}: {
  items: AnalyticsTimeBucket[];
  emptyLabel: string;
}) {
  const maximum = maxCount(items);

  if (items.length === 0) {
    return (
      <div className="empty-state empty-state--inline">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="analytics-bars">
      {items.map((item) => (
        <div
          className="analytics-bar"
          key={item.start}
        >
          <div>
            <strong>{item.start}</strong>
            <span>{item.count}</span>
          </div>
          <progress
            max={maximum}
            value={item.count}
            aria-label={item.start}
          />
        </div>
      ))}
    </div>
  );
}

export function AnalyticsDashboard({
  snapshot,
}: AnalyticsDashboardProps) {
  return (
    <>
      <section className="analytics-metrics">
        <article>
          <strong>{snapshot.totalRecords}</strong>
          <span>Records</span>
        </article>
        <article>
          <strong>
            {snapshot.deadlines.approaching}
          </strong>
          <span>
            Due within{" "}
            {snapshot.deadlines.horizonDays} days
          </span>
        </article>
        <article>
          <strong>
            {snapshot.deadlines.overdue}
          </strong>
          <span>Overdue deadlines</span>
        </article>
        <article>
          <strong>
            {
              snapshot.evidenceCoverage
                .recordCoveragePercent
            }
            %
          </strong>
          <span>Records with evidence</span>
        </article>
      </section>

      <section className="analytics-grid section-block">
        <article className="analytics-panel">
          <div className="section-heading section-heading--tight">
            <div>
              <p className="eyebrow">
                Registry composition
              </p>
              <h2>Records by type</h2>
            </div>
          </div>
          <CountList items={snapshot.byRecordType} />
        </article>

        <article className="analytics-panel">
          <div className="section-heading section-heading--tight">
            <div>
              <p className="eyebrow">
                Publication workflow
              </p>
              <h2>Records by status</h2>
            </div>
          </div>
          <CountList items={snapshot.byStatus} />
        </article>
      </section>

      <section className="analytics-grid section-block">
        <article className="analytics-panel">
          <div className="section-heading section-heading--tight">
            <div>
              <p className="eyebrow">Trend</p>
              <h2>Publications</h2>
            </div>
            <span className="metric">
              {snapshot.publicationTrendWindowDays} days
            </span>
          </div>
          <Trend
            items={snapshot.publicationTrend}
            emptyLabel="No publications occurred in this window."
          />
        </article>

        <article className="analytics-panel">
          <div className="section-heading section-heading--tight">
            <div>
              <p className="eyebrow">Audit activity</p>
              <h2>Record changes</h2>
            </div>
            <span className="metric">
              {snapshot.changeActivityWindowDays} days
            </span>
          </div>
          <Trend
            items={snapshot.changeActivity}
            emptyLabel="No record changes occurred in this window."
          />
        </article>
      </section>

      <section className="analytics-grid section-block">
        <article className="analytics-panel">
          <div className="section-heading section-heading--tight">
            <div>
              <p className="eyebrow">Obligations</p>
              <h2>Deadline health</h2>
            </div>
          </div>
          <dl className="analytics-definition-grid">
            <div>
              <dt>Open</dt>
              <dd>{snapshot.deadlines.open}</dd>
            </div>
            <div>
              <dt>Paused</dt>
              <dd>{snapshot.deadlines.paused}</dd>
            </div>
            <div>
              <dt>Approaching</dt>
              <dd>
                {snapshot.deadlines.approaching}
              </dd>
            </div>
            <div>
              <dt>Overdue</dt>
              <dd>{snapshot.deadlines.overdue}</dd>
            </div>
          </dl>
        </article>

        <article className="analytics-panel">
          <div className="section-heading section-heading--tight">
            <div>
              <p className="eyebrow">Traceability</p>
              <h2>Evidence coverage</h2>
            </div>
          </div>
          <dl className="analytics-definition-grid">
            <div>
              <dt>Records with evidence</dt>
              <dd>
                {
                  snapshot.evidenceCoverage
                    .recordsWithEvidence
                }
              </dd>
            </div>
            <div>
              <dt>Records without evidence</dt>
              <dd>
                {
                  snapshot.evidenceCoverage
                    .recordsWithoutEvidence
                }
              </dd>
            </div>
            <div>
              <dt>Cited sources</dt>
              <dd>
                {
                  snapshot.evidenceCoverage
                    .citedSourceCount
                }
              </dd>
            </div>
            <div>
              <dt>Source coverage</dt>
              <dd>
                {
                  snapshot.evidenceCoverage
                    .sourceCoveragePercent
                }
                %
              </dd>
            </div>
          </dl>
        </article>
      </section>

      {snapshot.dimensions.map((dimension) => (
        <section
          className="section-block analytics-panel"
          key={dimension.id}
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">
                Configured dimension
              </p>
              <h2>{dimension.label}</h2>
            </div>
            {dimension.suppressedCount > 0 ? (
              <span className="metric">
                {dimension.suppressedCount} outside
                displayed values
              </span>
            ) : null}
          </div>
          <CountList items={dimension.values} />
        </section>
      ))}
    </>
  );
}
