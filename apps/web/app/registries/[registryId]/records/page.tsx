import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Breadcrumbs } from "../../../../components/breadcrumbs";
import { RecordCard } from "../../../../components/record-card";
import {
  getPublicRegistry,
  listPublicRecords,
} from "../../../../lib/public-registry";
import { presentRecordSummary } from "@civic-registry/registry";

export const dynamic = "force-dynamic";

interface RecordsPageProps {
  params: Promise<{
    registryId: string;
  }>;
  searchParams: Promise<{
    type?: string | string[];
  }>;
}

function getRequestedType(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function generateMetadata({
  params,
  searchParams,
}: RecordsPageProps): Promise<Metadata> {
  const { registryId } = await params;
  const query = await searchParams;
  const registry = await getPublicRegistry(registryId);

  if (!registry) return { title: "Registry not found" };

  const requestedType = getRequestedType(query.type);
  const type = requestedType
    ? registry.config.recordTypesById.get(requestedType)
    : undefined;

  return {
    title: type
      ? `${type.definition.pluralName} — ${registry.config.definition.name}`
      : registry.config.definition.name,
  };
}

export default async function RecordsPage({
  params,
  searchParams,
}: RecordsPageProps) {
  const { registryId } = await params;
  const query = await searchParams;
  const registry = await getPublicRegistry(registryId);

  if (!registry) notFound();

  const requestedType = getRequestedType(query.type);
  const fallbackType =
    registry.config.definition.defaultRecordTypeId ??
    registry.config.definition.recordTypes[0]?.id;

  if (!fallbackType) notFound();

  const recordTypeId = requestedType ?? fallbackType;
  const recordType =
    registry.config.recordTypesById.get(recordTypeId);

  if (!recordType) {
    redirect(
      `/registries/${encodeURIComponent(
        registryId,
      )}/records?type=${encodeURIComponent(fallbackType)}`,
    );
  }

  const records = await listPublicRecords(
    registryId,
    recordTypeId,
  );
  const presented = records.map((record) =>
    presentRecordSummary(record, registry.config),
  );

  return (
    <main className="page-shell">
      <Breadcrumbs
        items={[
          { label: "Registries", href: "/" },
          {
            label: registry.config.definition.name,
            href: `/registries/${encodeURIComponent(registryId)}`,
          },
          { label: recordType.definition.pluralName },
        ]}
      />

      <header className="page-heading page-heading--compact">
        <p className="eyebrow">
          {registry.config.definition.name}
        </p>
        <h1>{recordType.definition.pluralName}</h1>
        {recordType.definition.description ? (
          <p className="lede">
            {recordType.definition.description}
          </p>
        ) : null}
      </header>

      <nav
        className="record-type-nav"
        aria-label="Record types"
      >
        {registry.config.definition.recordTypes.map((type) => {
          const active = type.id === recordTypeId;

          return (
            <Link
              key={type.id}
              className={active ? "is-active" : undefined}
              aria-current={active ? "page" : undefined}
              href={`/registries/${encodeURIComponent(
                registryId,
              )}/records?type=${encodeURIComponent(type.id)}`}
            >
              {type.pluralName}
            </Link>
          );
        })}
      </nav>

      <section
        className="section-block"
        aria-labelledby="records-heading"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">Publicly visible</p>
            <h2 id="records-heading">
              {presented.length}{" "}
              {presented.length === 1 ? "record" : "records"}
            </h2>
          </div>
        </div>

        {presented.length > 0 ? (
          <div className="record-list">
            {presented.map((record) => (
              <RecordCard
                key={record.id}
                record={record}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state empty-state--inline">
            <h3>No public records yet</h3>
            <p>
              This record type is configured, but no records with
              public visibility are currently available.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
