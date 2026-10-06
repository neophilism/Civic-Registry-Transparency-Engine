import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  presentRecordDetail,
} from "@civic-registry/registry";

import { Breadcrumbs } from "../../../../../../components/breadcrumbs";
import { RelationshipMap } from "../../../../../../components/relationship-map";
import {
  getPublicRecord,
  getPublicRegistry,
  getPublicRelationshipGraph,
} from "../../../../../../lib/public-registry";
import {
  firstRelationshipValue,
  relationshipDepthParam,
  relationshipValues,
  type RelationshipQueryParams,
} from "../../../../../../lib/relationship-params";

export const dynamic = "force-dynamic";

interface GraphPageProps {
  params: Promise<{
    registryId: string;
    recordId: string;
  }>;
  searchParams: Promise<RelationshipQueryParams>;
}

export async function generateMetadata({
  params,
}: GraphPageProps): Promise<Metadata> {
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
    title: `Relationship map — ${presented.title}`,
  };
}

export default async function GraphPage({
  params,
  searchParams,
}: GraphPageProps) {
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
  const depth = relationshipDepthParam(query.depth);
  const requestedTypes = relationshipValues(query.type);
  const relationshipTypeIds = requestedTypes.filter(
    (id) =>
      registry.config.relationshipTypesById.has(id),
  );
  const result = await getPublicRelationshipGraph(
    registry.config,
    record.id,
    {
      depth,
      relationshipTypeIds:
        relationshipTypeIds.length > 0
          ? relationshipTypeIds
          : undefined,
      maxNodes: 100,
    },
  );

  if (!result) notFound();

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
          { label: "Relationship map" },
        ]}
      />

      <header className="page-heading page-heading--compact">
        <p className="eyebrow">Graph exploration</p>
        <h1>Relationship map for {presented.title}</h1>
        <p className="lede">
          Explore public connections up to three hops from the root
          record. Traversal is bounded to keep graph expansion
          predictable.
        </p>
      </header>

      <section
        className="relationship-toolbar"
        aria-labelledby="graph-controls-heading"
      >
        <div>
          <p className="eyebrow">Traversal</p>
          <h2 id="graph-controls-heading">
            Map controls
          </h2>
        </div>

        <form method="get">
          <label>
            <span>Depth</span>
            <select
              name="depth"
              defaultValue={String(depth)}
            >
              <option value="1">1 hop</option>
              <option value="2">2 hops</option>
              <option value="3">3 hops</option>
            </select>
          </label>

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

          <button type="submit">Update map</button>
          <Link href={`${basePath}/graph`}>
            Clear
          </Link>
        </form>
      </section>

      {result.truncated ? (
        <div className="notice">
          The map reached its 100-node public safety cap. Reduce the
          depth or select a relationship type to narrow traversal.
        </div>
      ) : null}

      <section className="section-block">
        <RelationshipMap
          registryId={registryId}
          graph={result.graph}
        />
      </section>
    </main>
  );
}
