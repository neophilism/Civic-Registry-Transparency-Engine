import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  getPublicAnalytics,
} from "../lib/analytics";
import {
  getPublicRegistry,
  listPublicRecords,
} from "../lib/public-registry";

export const dynamic = "force-dynamic";

const REGISTRY_ID = "open-legal-interpretations";

export const metadata: Metadata = {
  title: "Open Legal Interpretations",
  description:
    "Searchable public reference application for significant legal interpretations, authorities, issuing offices, publication history, disclosure, and declassification deadlines.",
};

function textField(
  value: unknown,
): string | undefined {
  return typeof value === "string" && value.trim()
    ? value
    : undefined;
}

export default async function OpenLegalInterpretationsPage() {
  const registry =
    await getPublicRegistry(REGISTRY_ID);

  if (!registry) notFound();

  const [interpretations, analytics] =
    await Promise.all([
      listPublicRecords(
        REGISTRY_ID,
        "interpretation",
      ),
      getPublicAnalytics(registry.config),
    ]);

  const latest = interpretations.slice(0, 6);
  const recordBase =
    "/registries/" +
    encodeURIComponent(REGISTRY_ID);

  return (
    <main className="page-shell">
      <header className="page-heading">
        <p className="eyebrow">
          Reference application
        </p>
        <h1>Open Legal Interpretations</h1>
        <p className="lede">
          Search significant legal interpretations
          by issuing office, subject, authority,
          publication history, disclosure status,
          and related opinions. This thin
          application runs on the unmodified Civic
          Registry &amp; Transparency Engine.
        </p>
      </header>

      <section
        className="registry-search-entry"
        aria-labelledby="oli-search-heading"
      >
        <div>
          <p className="eyebrow">
            Search interpretations
          </p>
          <h2 id="oli-search-heading">
            Find published legal analysis
          </h2>
          <p>
            Search titles, summaries, holdings,
            source references, and imported
            interpretation text, then narrow by
            type, subject, date, issuing body, or
            other configured facets.
          </p>
        </div>
        <form
          method="get"
          action={
            recordBase + "/search"
          }
        >
          <input
            type="hidden"
            name="type"
            value="interpretation"
          />
          <label htmlFor="oli-search">
            Search terms
          </label>
          <div>
            <input
              id="oli-search"
              name="q"
              type="search"
              placeholder="Search legal interpretations"
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
            {analytics.recordTypes.find(
              (entry) =>
                entry.key === "interpretation",
            )?.count ?? 0}
          </strong>
          <span>Public interpretations</span>
        </div>
        <div>
          <strong>
            {analytics.recordTypes.find(
              (entry) =>
                entry.key === "issuing_body",
            )?.count ?? 0}
          </strong>
          <span>Issuing bodies</span>
        </div>
        <div>
          <strong>
            {analytics.recordTypes.find(
              (entry) =>
                entry.key === "legal_authority",
            )?.count ?? 0}
          </strong>
          <span>Legal authorities</span>
        </div>
        <div>
          <strong>
            {analytics.deadlines.overdue}
          </strong>
          <span>Overdue public reviews</span>
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              Browse the repository
            </p>
            <h2>Legal transparency records</h2>
          </div>
          <Link
            className="metric"
            href={recordBase + "/analytics"}
          >
            View analytics →
          </Link>
        </div>

        <div className="registry-grid">
          <Link
            className="registry-card"
            href={
              recordBase +
              "/records?type=interpretation"
            }
          >
            <span className="registry-card__kicker">
              Opinions and memoranda
            </span>
            <h3>Legal interpretations</h3>
            <p>
              Browse published, withdrawn,
              superseded, and archived
              interpretations with immutable
              history and evidence.
            </p>
            <span className="registry-card__action">
              Browse interpretations →
            </span>
          </Link>

          <Link
            className="registry-card"
            href={
              recordBase +
              "/records?type=issuing_body"
            }
          >
            <span className="registry-card__kicker">
              Provenance
            </span>
            <h3>Issuing bodies</h3>
            <p>
              Explore agencies, offices,
              components, and commissions connected
              to published interpretations.
            </p>
            <span className="registry-card__action">
              Browse issuing bodies →
            </span>
          </Link>

          <Link
            className="registry-card"
            href={
              recordBase +
              "/records?type=legal_authority"
            }
          >
            <span className="registry-card__kicker">
              Authority graph
            </span>
            <h3>Legal authorities</h3>
            <p>
              Trace statutes, regulations, cases,
              constitutional provisions, and other
              authorities to the interpretations
              that rely on them.
            </p>
            <span className="registry-card__action">
              Browse authorities →
            </span>
          </Link>
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              Recent public material
            </p>
            <h2>Latest interpretations</h2>
          </div>
          <Link
            className="metric"
            href={
              recordBase +
              "/search?type=interpretation"
            }
          >
            Search all →
          </Link>
        </div>

        {latest.length === 0 ? (
          <div className="empty-state empty-state--inline">
            No public legal interpretations have
            been published yet.
          </div>
        ) : (
          <div className="registry-grid">
            {latest.map((record) => {
              const title =
                textField(record.fields.title) ??
                record.id;
              const number = textField(
                record.fields
                  .interpretation_number,
              );
              const subject = textField(
                record.fields.subject,
              );
              const issuedOn = textField(
                record.fields.issued_on,
              );
              const summary = textField(
                record.fields.summary,
              );

              return (
                <Link
                  className="registry-card"
                  key={record.id}
                  href={
                    recordBase +
                    "/records/" +
                    encodeURIComponent(record.id)
                  }
                >
                  <span className="registry-card__kicker">
                    {number ??
                      "Legal interpretation"}
                    {issuedOn
                      ? " · " + issuedOn
                      : ""}
                  </span>
                  <h3>{title}</h3>
                  <p>
                    {summary ??
                      subject ??
                      "View the public interpretation record."}
                  </p>
                  {subject ? (
                    <span className="metric">
                      {subject}
                    </span>
                  ) : null}
                  <span className="registry-card__action">
                    View interpretation →
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
              Engine capabilities in use
            </p>
            <h2>
              Thin application, shared infrastructure
            </h2>
          </div>
        </div>
        <p className="lede">
          Publication approvals, disclosure and
          redaction, deadlines, evidence citations,
          relationship graphs, full-text search,
          public API/export, analytics,
          notifications, immutable revision history,
          and cryptographic audit integrity all come
          from the reusable engine. This application
          contributes domain configuration,
          terminology, fixtures, import mapping, and
          presentation only.
        </p>
      </section>
    </main>
  );
}
