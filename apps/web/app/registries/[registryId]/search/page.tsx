import type { Metadata } from "next";
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

interface SearchPageProps {
  params: Promise<{
    registryId: string;
  }>;
  searchParams: Promise<PublicSearchParams>;
}

export async function generateMetadata({
  params,
}: SearchPageProps): Promise<Metadata> {
  const { registryId } = await params;
  const registry = await getPublicRegistry(registryId);

  return {
    title: registry
      ? `Search — ${registry.config.definition.name}`
      : "Registry not found",
  };
}

export default async function RegistrySearchPage({
  params,
  searchParams,
}: SearchPageProps) {
  const { registryId } = await params;
  const query = await searchParams;
  const registry = await getPublicRegistry(registryId);

  if (!registry) notFound();

  const selectedTypeId = firstSearchValue(query.type);
  const recordType = selectedTypeId
    ? registry.config.recordTypesById.get(selectedTypeId)
    : undefined;

  if (selectedTypeId && !recordType) {
    redirect(
      `/registries/${encodeURIComponent(registryId)}/search`,
    );
  }

  const request = parsePublicSearchRequest(
    registry.config,
    query,
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
  )}/search`;

  return (
    <main className="page-shell">
      <Breadcrumbs
        items={[
          { label: "Registries", href: "/" },
          {
            label: registry.config.definition.name,
            href: `/registries/${encodeURIComponent(registryId)}`,
          },
          { label: "Search" },
        ]}
      />

      <header className="page-heading page-heading--compact">
        <p className="eyebrow">Registry-wide discovery</p>
        <h1>Search {registry.config.definition.name}</h1>
        <p className="lede">
          Search all public record types together, or narrow the
          query to a configured type to unlock its field-specific
          filters.
        </p>
      </header>

      <section
        className="section-block section-block--search"
        aria-labelledby="registry-search-heading"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">Discovery</p>
            <h2 id="registry-search-heading">
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
          includeRecordType
        />
      </section>

      <section
        className="section-block"
        aria-labelledby="search-results-heading"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">Results</p>
            <h2 id="search-results-heading">
              {result.total}{" "}
              {result.total === 1 ? "record" : "records"}
            </h2>
          </div>
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
              Try a broader query or remove one of the selected
              filters.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
