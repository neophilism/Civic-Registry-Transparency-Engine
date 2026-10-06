import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  presentRecordDetail,
} from "@civic-registry/registry";

import { Breadcrumbs } from "../../../../../../components/breadcrumbs";
import { RelationshipGroups } from "../../../../../../components/relationship-groups";
import {
  getPublicRecord,
  getPublicRegistry,
  listPublicRelationships,
} from "../../../../../../lib/public-registry";
import {
  firstRelationshipValue,
  relationshipDirectionParam,
  relationshipValues,
  type RelationshipQueryParams,
} from "../../../../../../lib/relationship-params";

export const dynamic = "force-dynamic";

interface RelationshipsPageProps {
  params: Promise<{
    registryId: string;
    recordId: string;
  }>;
  searchParams: Promise<RelationshipQueryParams>;
}

export async function generateMetadata({
  params,
}: RelationshipsPageProps): Promise<Metadata> {
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
    title: `Relationships — ${presented.title}`,
  };
}

export default async function RelationshipsPage({
  params,
  searchParams,
}: RelationshipsPageProps) {
  const { registryId, recordId } = await params;
  const query = await searchParams;
  const [registry, record] = await Promise.all([
    getPublicRegistry(registryId),
    getPublicRecord(registryId, recordId),
  ]);

  if (!registry || !record) notFound();

  const presented = presentRecordDetail(
    record,
    registry.config,
  );
  const requestedTypes = relationshipValues(query.type);
  const relationshipTypeIds = requestedTypes.filter(
    (id) =>
      registry.config.relationshipTypesById.has(id),
  );
  const direction = relationshipDirectionParam(
    query.direction,
  );
  const result = await listPublicRelationships(
    registry.config,
    record,
    {
      relationshipTypeIds:
        relationshipTypeIds.length > 0
          ? relationshipTypeIds
          : undefined,
      direction,
      maxNodes: 201,
    },
  );

  const basePath = `/registries/${encodeURIComponent(
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
            href: basePath,
          },
          { label: "Relationships" },
        ]}
      />

      <header className="page-heading page-heading--compact">
        <p className="eyebrow">Connected records</p>
        <h1>Relationships for {presented.title}</h1>
        <p className="lede">
          Browse direct public connections using the relationship
          vocabulary configured for this registry.
        </p>
      </header>

      <section
        className="relationship-toolbar"
        aria-labelledby="relationship-filter-heading"
      >
        <div>
          <p className="eyebrow">Filter</p>
          <h2 id="relationship-filter-heading">
            Direct connections
          </h2>
        </div>

        <form method="get">
          <label>
            <span>Relationship type</span>
            <select
              name="type"
              defaultValue={
                firstRelationshipValue(query.type) ?? ""
              }
            >
              <option value="">All types</option>
              {[
                ...registry.config.relationshipTypesById.values(),
              ].map((type) => (
                <option key={type.id} value={type.id}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Direction</span>
            <select
              name="direction"
              defaultValue={direction ?? ""}
            >
              <option value="">All directions</option>
              <option value="outbound">Outbound</option>
              <option value="inbound">Inbound</option>
              <option value="undirected">Undirected</option>
            </select>
          </label>

          <button type="submit">Apply</button>
          <Link href={`${basePath}/relationships`}>
            Clear
          </Link>
        </form>
      </section>

      <section
        className="section-block"
        aria-labelledby="relationship-results-heading"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">Publicly visible</p>
            <h2 id="relationship-results-heading">
              {result.relationships.length}{" "}
              {result.relationships.length === 1
                ? "relationship"
                : "relationships"}
            </h2>
          </div>
          <Link
            className="button-link"
            href={`${basePath}/graph${
              relationshipTypeIds.length > 0
                ? `?type=${encodeURIComponent(
                    relationshipTypeIds[0],
                  )}`
                : ""
            }`}
          >
            Open relationship map
          </Link>
        </div>

        {result.truncated ? (
          <div className="notice">
            This view reached the public connection limit. Use a
            relationship-type filter to narrow the results.
          </div>
        ) : null}

        {result.groups.length > 0 ? (
          <RelationshipGroups
            registryId={registryId}
            groups={result.groups}
          />
        ) : (
          <div className="empty-state empty-state--inline">
            <h3>No matching public relationships</h3>
            <p>
              This record has no direct public connections matching
              the selected filters.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
