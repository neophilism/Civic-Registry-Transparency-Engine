import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { presentRecordSummary } from "@civic-registry/registry";

import { Breadcrumbs } from "../../../../components/breadcrumbs";
import { Pagination } from "../../../../components/pagination";
import { RecordCard } from "../../../../components/record-card";
import { SearchControls } from "../../../../components/search-controls";
import {
  getPublicRegistry,
  searchPublicRecords,
} from "../../../../lib/public-registry";
import {
  firstSearchValue,
  parsePublicSearchRequest,
  type PublicSearchParams,
} from "../../../../lib/search-params";

export const dynamic = "force-dynamic";

interface RecordsPageProps {
  params: Promise<{
    registryId: string;
  }>;
  searchParams: Promise<PublicSearchParams>;
}

export async function generateMetadata({
  params,
  searchParams,
}: RecordsPageProps): Promise<Metadata> {
  const { registryId } = await params;
  const query = await searchParams;
  const registry = await getPublicRegistry(registryId);

  if (!registry) return { title: "Registry not found" };

  const requestedType = firstSearchValue(query.type);
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

  const requestedType = firstSearchValue(query.type);
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

  const request = parsePublicSearchRequest(
    registry.config,
    query,
    recordTypeId,
  );
  const result = await searchPublicRecords(
    registry.config,
    request,
  );
  const presented = result.hits.map(({ record }) =>
    presentRecordSummary(record, registry.config),
  );
  const basePath = `/registries/${encodeURIComponent(
    registryId,
  )}/records`;

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
              href={`${basePath}?type=${encodeURIComponent(type.id)}`}
            >
              {type.pluralName}
            </Link>
          );
        })}
        <Link
          href={`/registries/${encodeURIComponent(
            registryId,
          )}/search`}
        >
          Search all types
        </Link>
      </nav>

      <section
        className="section-block section-block--search"
        aria-labelledby="search-heading"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">Discovery</p>
            <h2 id="search-heading">
              Search and filter
            </h2>
          </div>
        </div>

        <SearchControls
          registry={registry.config}
          recordType={recordType}
          facets={result.facets}
          params={query}
          action={basePath}
        />
      </section>

      <section
        className="section-block"
        aria-labelledby="records-heading"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">Publicly visible</p>
            <h2 id="records-heading">
              {result.total}{" "}
              {result.total === 1 ? "record" : "records"}
            </h2>
          </div>
          {firstSearchValue(query.q) ? (
            <span className="metric">
              Query: “{firstSearchValue(query.q)}”
            </span>
          ) : null}
        </div>

        {presented.length > 0 ? (
          <>
            <div className="record-list">
              {presented.map((record) => (
                <RecordCard
                  key={record.id}
                  record={record}
                />
              ))}
            </div>
            <Pagination
              basePath={basePath}
              params={query}
              page={result.page}
              pageSize={result.pageSize}
              total={result.total}
            />
          </>
        ) : (
          <div className="empty-state empty-state--inline">
            <h3>No matching public records</h3>
            <p>
              Try removing a filter, broadening the date range,
              or using fewer search terms.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
