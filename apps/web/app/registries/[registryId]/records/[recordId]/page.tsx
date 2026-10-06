import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  presentRecordDetail,
} from "@civic-registry/registry";

import { Breadcrumbs } from "../../../../../components/breadcrumbs";
import { DeadlineList } from "../../../../../components/deadline-list";
import { EvidenceGroups } from "../../../../../components/evidence-groups";
import { HistoryTimeline } from "../../../../../components/history-timeline";
import { RecordFieldValue } from "../../../../../components/record-field";
import { RelationshipGroups } from "../../../../../components/relationship-groups";
import { formatDateTime } from "../../../../../lib/format";
import {
  getPublicDeadlines,
  getPublicEvidence,
  getPublicHistory,
  getPublicRecordView,
  getPublicRegistry,
  listPublicRelationships,
} from "../../../../../lib/public-registry";

export const dynamic = "force-dynamic";

interface RecordPageProps {
  params: Promise<{
    registryId: string;
    recordId: string;
  }>;
}

export async function generateMetadata({
  params,
}: RecordPageProps): Promise<Metadata> {
  const { registryId, recordId } = await params;
  const [registry, recordView] = await Promise.all([
    getPublicRegistry(registryId),
    getPublicRecordView(registryId, recordId),
  ]);

  if (!registry || !recordView) {
    return { title: "Record not found" };
  }

  const presented = presentRecordDetail(
    recordView.record,
    registry.config,
    recordView.disclosure,
  );

  return {
    title: `${presented.title} — ${registry.config.definition.name}`,
    description: presented.summary,
  };
}

export default async function RecordPage({
  params,
}: RecordPageProps) {
  const { registryId, recordId } = await params;
  const [registry, recordView] = await Promise.all([
    getPublicRegistry(registryId),
    getPublicRecordView(registryId, recordId),
  ]);

  if (!registry || !recordView) notFound();

  const record = recordView.record;
  const presented = presentRecordDetail(
    record,
    registry.config,
    recordView.disclosure,
  );
  const recordType = registry.config.getRecordType(
    record.recordTypeId,
  );
  const [
    relationshipResult,
    deadlines,
    evidence,
    history,
  ] = await Promise.all([
    listPublicRelationships(
      registry.config,
      record,
      {
        maxNodes: 101,
      },
    ),
    getPublicDeadlines(
      registry.config,
      record,
    ),
    getPublicEvidence(
      registry.config,
      record,
    ),
    getPublicHistory(
      registry.config,
      record,
    ),
  ]);

  return (
    <main className="page-shell">
      <Breadcrumbs
        items={[
          { label: "Registries", href: "/" },
          {
            label: registry.config.definition.name,
            href: `/registries/${encodeURIComponent(registryId)}`,
          },
          {
            label: recordType.definition.pluralName,
            href: `/registries/${encodeURIComponent(
              registryId,
            )}/records?type=${encodeURIComponent(record.recordTypeId)}`,
          },
          { label: presented.title },
        ]}
      />

      <header className="record-heading">
        <div>
          <p className="eyebrow">
            {presented.recordTypeName}
          </p>
          <h1>{presented.title}</h1>
          {presented.summary ? (
            <p className="lede">{presented.summary}</p>
          ) : null}
        </div>

        <div className="status-stack">
          <span className="status-pill">
            {presented.statusLabel}
          </span>
          <span className="status-pill status-pill--quiet">
            {presented.visibility}
          </span>
        </div>
      </header>

      {presented.disclosure &&
      presented.disclosure.disposition !==
        "disclosed" ? (
        <section
          className="disclosure-notice"
          aria-label="Disclosure status"
        >
          <div>
            <p className="eyebrow">
              Public disclosure
            </p>
            <h2>
              {presented.disclosure.disposition ===
              "withheld"
                ? "Record contents withheld"
                : "Record contains redactions"}
            </h2>
          </div>
          <div className="disclosure-notice__detail">
            {presented.disclosure.publicNote ? (
              <p>{presented.disclosure.publicNote}</p>
            ) : null}
            {presented.disclosure.reason ? (
              <p>
                <strong>Reason:</strong>{" "}
                {presented.disclosure.reason}
              </p>
            ) : null}
            {presented.disclosure.authority ? (
              <p>
                <strong>Authority:</strong>{" "}
                {presented.disclosure.authority}
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="record-layout">
        <section
          className="record-panel"
          aria-labelledby="record-fields-heading"
        >
          <div className="section-heading section-heading--tight">
            <div>
              <p className="eyebrow">Record data</p>
              <h2 id="record-fields-heading">Details</h2>
            </div>
          </div>

          <dl className="detail-list">
            {presented.fields.map((field) => (
              <div key={field.id}>
                <dt>{field.label}</dt>
                <dd>
                  <RecordFieldValue
                    field={field}
                    registryId={registryId}
                  />
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <aside className="record-sidebar">
          <section className="record-panel">
            <p className="eyebrow">Registry metadata</p>
            <dl className="metadata-list">
              <div>
                <dt>Record ID</dt>
                <dd className="mono">{presented.id}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{formatDateTime(presented.createdAt)}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{formatDateTime(presented.updatedAt)}</dd>
              </div>
              <div>
                <dt>Published</dt>
                <dd>{formatDateTime(presented.publishedAt)}</dd>
              </div>
            </dl>
          </section>

          {presented.tags.length > 0 ? (
            <section className="record-panel">
              <p className="eyebrow">Tags</p>
              <div className="tag-list">
                {presented.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            </section>
          ) : null}

          {presented.externalIdentifiers.length > 0 ? (
            <section className="record-panel">
              <p className="eyebrow">
                External identifiers
              </p>
              <ul className="identifier-list">
                {presented.externalIdentifiers.map(
                  (identifier) => (
                    <li
                      key={`${identifier.scheme}:${identifier.value}`}
                    >
                      <strong>{identifier.scheme}</strong>
                      {identifier.url ? (
                        <a
                          href={identifier.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {identifier.value}
                        </a>
                      ) : (
                        <span>{identifier.value}</span>
                      )}
                    </li>
                  ),
                )}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>

      {deadlines.length > 0 ? (
        <section
          className="section-block"
          aria-labelledby="deadlines-heading"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">
                Time-sensitive obligations
              </p>
              <h2 id="deadlines-heading">
                Deadlines
              </h2>
            </div>
            <span className="metric">
              {deadlines.length}{" "}
              {deadlines.length === 1
                ? "deadline"
                : "deadlines"}
            </span>
          </div>

          <DeadlineList deadlines={deadlines} />
        </section>
      ) : null}

      {history.events.length > 0 ||
      history.revisions.length > 0 ? (
        <section
          className="section-block"
          aria-labelledby="history-summary-heading"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">Change tracking</p>
              <h2 id="history-summary-heading">
                History
              </h2>
            </div>
            <div className="section-actions">
              <span className="metric">
                {history.revisions.length}{" "}
                {history.revisions.length === 1
                  ? "revision"
                  : "revisions"}
              </span>
              <Link
                href={`/registries/${encodeURIComponent(
                  registryId,
                )}/records/${encodeURIComponent(
                  recordId,
                )}/history`}
              >
                View full history
              </Link>
            </div>
          </div>

          {history.events.length > 0 ? (
            <HistoryTimeline
              events={history.events}
              limit={3}
            />
          ) : null}
        </section>
      ) : null}

      {evidence.groups.length > 0 ? (
        <section
          className="section-block"
          aria-labelledby="evidence-summary-heading"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">Traceability</p>
              <h2 id="evidence-summary-heading">
                Evidence
              </h2>
            </div>
            <div className="section-actions">
              <span className="metric">
                {evidence.citations.length}{" "}
                {evidence.citations.length === 1
                  ? "citation"
                  : "citations"}
              </span>
              <Link
                href={`/registries/${encodeURIComponent(
                  registryId,
                )}/records/${encodeURIComponent(
                  recordId,
                )}/evidence`}
              >
                View all evidence
              </Link>
            </div>
          </div>

          <EvidenceGroups
            groups={evidence.groups}
            limitPerGroup={2}
          />
        </section>
      ) : null}

      {relationshipResult.groups.length > 0 ? (
        <section
          className="section-block"
          aria-labelledby="relationships-heading"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">Connected records</p>
              <h2 id="relationships-heading">Relationships</h2>
            </div>
            <div className="section-actions">
              <Link
                href={`/registries/${encodeURIComponent(
                  registryId,
                )}/records/${encodeURIComponent(
                  recordId,
                )}/relationships`}
              >
                Browse all
              </Link>
              <Link
                href={`/registries/${encodeURIComponent(
                  registryId,
                )}/records/${encodeURIComponent(
                  recordId,
                )}/graph`}
              >
                Relationship map
              </Link>
            </div>
          </div>

          {relationshipResult.truncated ? (
            <div className="notice">
              Only the first public connections are shown in this
              summary. Open the relationship browser to narrow the
              result by type.
            </div>
          ) : null}

          <RelationshipGroups
            registryId={registryId}
            groups={relationshipResult.groups}
            limitPerGroup={4}
          />
        </section>
      ) : null}
    </main>
  );
}
