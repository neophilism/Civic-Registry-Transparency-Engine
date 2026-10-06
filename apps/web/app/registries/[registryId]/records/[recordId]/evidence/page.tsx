import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  presentRecordDetail,
} from "@civic-registry/registry";

import { Breadcrumbs } from "../../../../../../components/breadcrumbs";
import { EvidenceGroups } from "../../../../../../components/evidence-groups";
import {
  getPublicEvidence,
  getPublicRecord,
  getPublicRegistry,
} from "../../../../../../lib/public-registry";

export const dynamic = "force-dynamic";

interface EvidencePageProps {
  params: Promise<{
    registryId: string;
    recordId: string;
  }>;
}

export async function generateMetadata({
  params,
}: EvidencePageProps): Promise<Metadata> {
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
    title: `Evidence — ${presented.title}`,
  };
}

export default async function EvidencePage({
  params,
}: EvidencePageProps) {
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
  const evidence = await getPublicEvidence(
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
          { label: "Evidence" },
        ]}
      />

      <header className="page-heading page-heading--compact">
        <p className="eyebrow">Evidence traceability</p>
        <h1>Evidence for {presented.title}</h1>
        <p className="lede">
          Public source and document citations supporting this
          record, grouped by the record field they substantiate.
        </p>
      </header>

      <section
        className="section-block"
        aria-labelledby="evidence-heading"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">Publicly visible</p>
            <h2 id="evidence-heading">
              {evidence.citations.length}{" "}
              {evidence.citations.length === 1
                ? "citation"
                : "citations"}
            </h2>
          </div>
        </div>

        {evidence.groups.length > 0 ? (
          <EvidenceGroups groups={evidence.groups} />
        ) : (
          <div className="empty-state empty-state--inline">
            <h3>No public evidence citations yet</h3>
            <p>
              This record does not currently have source or document
              citations marked for public display.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
