import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  getPublicAnalytics,
} from "../../lib/analytics";
import {
  getConfiguredComplianceProjection,
  type ComplianceProjectionResult,
} from "../../lib/compliance-projection";
import {
  getPublicRegistry,
  listPublicRecords,
} from "../../lib/public-registry";

export const dynamic = "force-dynamic";

const REGISTRY_ID =
  "smart-cities-surveillance-registry";

export const metadata: Metadata = {
  title:
    "Smart Cities Surveillance Registry",
  description:
    "Public reference application for surveillance technologies, deployments, policies, retention, sharing, audits, violations, and compliance status.",
};

function textField(
  value: unknown,
): string | undefined {
  return typeof value === "string" &&
    value.trim()
    ? value.trim()
    : undefined;
}

function numberField(
  value: unknown,
): number | undefined {
  return typeof value === "number" &&
    Number.isFinite(value)
    ? value
    : undefined;
}

function projectionSummary(
  result:
    ComplianceProjectionResult | undefined,
): string | undefined {
  if (
    !result ||
    result.status ===
      "not_configured"
  ) {
    return undefined;
  }

  if (result.status === "unavailable") {
    return "Compliance projection unavailable";
  }

  const latest =
    result.projection.latestCheck;
  const findings =
    result.projection.findings;
  const certifications =
    result.projection.certifications;

  if (!latest) {
    return (
      "No completed compliance check · " +
      findings.unresolvedCount +
      " unresolved findings · " +
      certifications.validCount +
      " valid certifications"
    );
  }

  return (
    "Compliance " +
    latest.status +
    " · " +
    findings.unresolvedCount +
    " unresolved findings · " +
    findings.unresolvedHighCriticalCount +
    " high/critical · " +
    certifications.validCount +
    " valid certifications"
  );
}

export default async function SmartCitiesSurveillanceRegistryPage() {
  const registry =
    await getPublicRegistry(
      REGISTRY_ID,
    );

  if (!registry) notFound();

  const [
    deployments,
    analytics,
  ] = await Promise.all([
    listPublicRecords(
      REGISTRY_ID,
      "deployment",
    ),
    getPublicAnalytics(
      registry.config,
    ),
  ]);

  const latest =
    deployments.slice(0, 6);
  const compliancePairs =
    await Promise.all(
      latest.map(async (record) => {
        const resourceId =
          textField(
            record.fields
              .compliance_resource_id,
          );

        if (!resourceId) {
          return [
            record.id,
            undefined,
          ] as const;
        }

        return [
          record.id,
          await getConfiguredComplianceProjection(
            resourceId,
          ),
        ] as const;
      }),
    );
  const complianceByRecord =
    new Map(compliancePairs);
  const recordBase =
    "/registries/" +
    encodeURIComponent(
      REGISTRY_ID,
    );
  const count = (
    recordTypeId: string,
  ) =>
    analytics.recordTypes.find(
      (entry) =>
        entry.key ===
        recordTypeId,
    )?.count ?? 0;

  return (
    <main className="page-shell">
      <header className="page-heading">
        <p className="eyebrow">
          Reference application
        </p>
        <h1>
          Smart Cities Surveillance Registry
        </h1>
        <p className="lede">
          Browse public information about
          surveillance technologies,
          deployments, agencies, vendors,
          approved-use policies, retention
          periods, sharing rules, legal-process
          requirements, audits, and reported
          violations. This reference application
          intentionally excludes sensitive
          operational details.
        </p>
      </header>

      <section
        className="registry-search-entry"
        aria-labelledby="smart-cities-search-heading"
      >
        <div>
          <p className="eyebrow">
            Search accountability records
          </p>
          <h2 id="smart-cities-search-heading">
            Find public surveillance records
          </h2>
          <p>
            Search by jurisdiction, deployment,
            technology, policy language, audit
            findings, vendor, agency, or reported
            violation using the shared registry
            search engine.
          </p>
        </div>
        <form
          method="get"
          action={
            recordBase + "/search"
          }
        >
          <label htmlFor="smart-cities-search">
            Search terms
          </label>
          <div>
            <input
              id="smart-cities-search"
              name="q"
              type="search"
              placeholder="Search surveillance registry"
            />
            <button type="submit">
              Search
            </button>
          </div>
        </form>
      </section>

      <section className="analytics-metrics">
        <div>
          <strong>
            {count("deployment")}
          </strong>
          <span>Public deployments</span>
        </div>
        <div>
          <strong>
            {count("technology")}
          </strong>
          <span>Technologies</span>
        </div>
        <div>
          <strong>
            {count("audit")}
          </strong>
          <span>Published audits</span>
        </div>
        <div>
          <strong>
            {count("violation")}
          </strong>
          <span>Reported violations</span>
        </div>
        <div>
          <strong>
            {analytics.deadlines.overdue}
          </strong>
          <span>
            Overdue public deadlines
          </span>
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              Browse the registry
            </p>
            <h2>
              Technology, policy, and
              accountability
            </h2>
          </div>
          <Link
            className="metric"
            href={
              recordBase +
              "/analytics"
            }
          >
            View analytics →
          </Link>
        </div>

        <div className="registry-grid">
          <Link
            className="registry-card"
            href={
              recordBase +
              "/records?type=deployment"
            }
          >
            <span className="registry-card__kicker">
              Public use
            </span>
            <h3>Deployments</h3>
            <p>
              See purpose, public location
              scope, data categories,
              retention periods, sharing
              rules, legal-process
              requirements, and audit dates.
            </p>
            <span className="registry-card__action">
              Browse deployments →
            </span>
          </Link>

          <Link
            className="registry-card"
            href={
              recordBase +
              "/records?type=technology"
            }
          >
            <span className="registry-card__kicker">
              Capabilities
            </span>
            <h3>Technologies</h3>
            <p>
              Explore technology categories,
              sensors, data categories, and
              vendor relationships without
              publishing operational secrets.
            </p>
            <span className="registry-card__action">
              Browse technologies →
            </span>
          </Link>

          <Link
            className="registry-card"
            href={
              recordBase +
              "/records?type=policy"
            }
          >
            <span className="registry-card__kicker">
              Governing controls
            </span>
            <h3>Policies</h3>
            <p>
              Review approved-use,
              retention/deletion, access,
              sharing, privacy, and
              legal-process policies with
              source evidence.
            </p>
            <span className="registry-card__action">
              Browse policies →
            </span>
          </Link>

          <Link
            className="registry-card"
            href={
              recordBase +
              "/records?type=audit"
            }
          >
            <span className="registry-card__kicker">
              Oversight
            </span>
            <h3>Audits</h3>
            <p>
              Browse annual, privacy,
              access, retention, and incident
              audits connected to the
              deployments they evaluate.
            </p>
            <span className="registry-card__action">
              Browse audits →
            </span>
          </Link>

          <Link
            className="registry-card"
            href={
              recordBase +
              "/records?type=violation"
            }
          >
            <span className="registry-card__kicker">
              Accountability
            </span>
            <h3>Reported violations</h3>
            <p>
              Follow publicly reportable
              findings, status, remediation
              deadlines, and the deployment
              relationships behind them.
            </p>
            <span className="registry-card__action">
              Browse violations →
            </span>
          </Link>
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              Current deployments
            </p>
            <h2>
              Public deployment summaries
            </h2>
          </div>
          <Link
            className="metric"
            href={
              recordBase +
              "/records?type=deployment"
            }
          >
            View all →
          </Link>
        </div>

        {latest.length === 0 ? (
          <div className="empty-state empty-state--inline">
            No public deployments have
            been published yet.
          </div>
        ) : (
          <div className="registry-grid">
            {latest.map((record) => {
              const name =
                textField(
                  record.fields.name,
                ) ?? record.id;
              const jurisdiction =
                textField(
                  record.fields
                    .jurisdiction,
                );
              const status =
                textField(
                  record.fields
                    .deployment_status,
                );
              const summary =
                textField(
                  record.fields
                    .public_summary,
                );
              const retentionDays =
                numberField(
                  record.fields
                    .retention_days,
                );
              const nextAudit =
                textField(
                  record.fields
                    .next_audit_due_on,
                );
              const compliance =
                projectionSummary(
                  complianceByRecord.get(
                    record.id,
                  ),
                );

              return (
                <Link
                  className="registry-card"
                  key={record.id}
                  href={
                    recordBase +
                    "/records/" +
                    encodeURIComponent(
                      record.id,
                    )
                  }
                >
                  <span className="registry-card__kicker">
                    {jurisdiction ??
                      "Public deployment"}
                    {status
                      ? " · " + status
                      : ""}
                  </span>
                  <h3>{name}</h3>
                  <p>
                    {summary ??
                      "View the public deployment record."}
                  </p>
                  <div className="registry-card__footer">
                    <span>
                      {retentionDays !==
                      undefined
                        ? retentionDays +
                          "-day retention"
                        : "Retention not specified"}
                      {nextAudit
                        ? " · audit due " +
                          nextAudit
                        : ""}
                    </span>
                  </div>
                  {compliance ? (
                    <span className="metric">
                      {compliance}
                    </span>
                  ) : null}
                  <span className="registry-card__action">
                    View deployment →
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              Cross-engine architecture
            </p>
            <h2>
              Transparency here;
              enforcement there
            </h2>
          </div>
        </div>
        <p className="lede">
          This registry publishes public
          accountability information through
          the Civic Registry &amp;
          Transparency Engine. Retention,
          deletion, authorization, evidence,
          findings, remediation, and
          certification enforcement belong in
          the separate Compliance,
          Authorization &amp; Immutable Audit
          Engine. When configured, this page
          reads only that engine&apos;s
          public-safe registry projection
          through its stable service API.
        </p>
      </section>

      <section className="section-block">
        <p className="eyebrow">
          Demonstration-data boundary
        </p>
        <h2>
          Public-safe reference data
        </h2>
        <p className="lede">
          The included records are synthetic.
          They demonstrate policy,
          accountability, deadlines,
          evidence, graph relationships, and
          cross-engine integration without
          describing real live surveillance
          operations, device coordinates,
          credentials, or sensitive
          investigative techniques.
        </p>
      </section>
    </main>
  );
}
