import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  presentRecordDetail,
} from "@civic-registry/registry";

import { Breadcrumbs } from "../../../../../../components/breadcrumbs";
import { HistoryTimeline } from "../../../../../../components/history-timeline";
import { RevisionHistory } from "../../../../../../components/revision-history";
import {
  getPublicHistory,
  getPublicRecord,
  getPublicRegistry,
} from "../../../../../../lib/public-registry";

export const dynamic = "force-dynamic";

interface HistoryPageProps {
  params: Promise<{
    registryId: string;
    recordId: string;
  }>;
}

export async function generateMetadata({
  params,
}: HistoryPageProps): Promise<Metadata> {
  const { registryId, recordId } = await params;
  const [registry, record] = await Promise.all([
    getPublicRegistry(registryId),
    getPublicRecord(registryId, recordId),
  ]);

  if (!registry || !record) {
    return { title: "Record not found" };
  }

  const presented = presentRecordDetail(
    record,
    registry.config,
  );

  return {
    title: `History — ${presented.title}`,
  };
}

export default async function HistoryPage({
  params,
}: HistoryPageProps) {
  const { registryId, recordId } = await params;
  const [registry, record] = await Promise.all([
    getPublicRegistry(registryId),
    getPublicRecord(registryId, recordId),
  ]);

  if (!registry || !record) notFound();

  const presented = presentRecordDetail(
    record,
    registry.config,
  );
  const history = await getPublicHistory(
    registry.config,
    record,
  );

  const recordPath = `/registries/${encodeURIComponent(
    registryId,
  )}/records/${encodeURIComponent(recordId)}`;

  return (
    <main className="page-shell">
      <Breadcrumbs
        items={[
          { label: "Registries", href: "/" },
          {
            label: registry.config.definition.name,
            href: `/registries/${encodeURIComponent(
              registryId,
            )}`,
          },
          {
            label: presented.title,
            href: recordPath,
          },
          { label: "History" },
        ]}
      />

      <header className="page-heading page-heading--compact">
        <p className="eyebrow">Immutable change tracking</p>
        <h1>History for {presented.title}</h1>
        <p className="lede">
          Publicly visible change events and immutable snapshots of
          this record. Non-public revisions and events are excluded
          from this view.
        </p>
      </header>

      <section
        className="section-block"
        aria-labelledby="timeline-heading"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">Audit timeline</p>
            <h2 id="timeline-heading">
              {history.events.length}{" "}
              {history.events.length === 1
                ? "public event"
                : "public events"}
            </h2>
          </div>
        </div>

        {history.events.length > 0 ? (
          <HistoryTimeline events={history.events} />
        ) : (
          <div className="empty-state empty-state--inline">
            <h3>No public history events</h3>
            <p>
              No audit events for this record are currently public.
            </p>
          </div>
        )}
      </section>

      <section
        className="section-block"
        aria-labelledby="revisions-heading"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">Immutable snapshots</p>
            <h2 id="revisions-heading">
              {history.revisions.length}{" "}
              {history.revisions.length === 1
                ? "public revision"
                : "public revisions"}
            </h2>
          </div>
        </div>

        {history.revisions.length > 0 ? (
          <RevisionHistory
            revisions={history.revisions}
          />
        ) : (
          <div className="empty-state empty-state--inline">
            <h3>No public revision snapshots</h3>
            <p>
              This record has no immutable snapshots available for
              public display.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
