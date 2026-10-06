import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Breadcrumbs } from "../../../components/breadcrumbs";
import { getPublicRegistry } from "../../../lib/public-registry";

export const dynamic = "force-dynamic";

interface RegistryPageProps {
  params: Promise<{
    registryId: string;
  }>;
}

export async function generateMetadata({
  params,
}: RegistryPageProps): Promise<Metadata> {
  const { registryId } = await params;
  const registry = await getPublicRegistry(registryId);

  if (!registry) {
    return {
      title: "Registry not found",
    };
  }

  return {
    title: registry.config.definition.name,
    description:
      registry.config.definition.description ??
      `Browse the ${registry.config.definition.name} public registry.`,
  };
}

export default async function RegistryPage({
  params,
}: RegistryPageProps) {
  const { registryId } = await params;
  const registry = await getPublicRegistry(registryId);

  if (!registry) notFound();

  const definition = registry.config.definition;

  return (
    <main className="page-shell">
      <Breadcrumbs
        items={[
          { label: "Registries", href: "/" },
          { label: definition.name },
        ]}
      />

      <header className="page-heading">
        <p className="eyebrow">Public registry</p>
        <h1>{definition.name}</h1>
        {definition.description ? (
          <p className="lede">{definition.description}</p>
        ) : null}
      </header>

      <section
        className="registry-search-entry"
        aria-labelledby="registry-search-entry-heading"
      >
        <div>
          <p className="eyebrow">Search the registry</p>
          <h2 id="registry-search-entry-heading">
            Find public records
          </h2>
          <p>
            Search across every configured public record type, then
            narrow the results with record-type and field-specific
            filters.
          </p>
        </div>
        <form
          method="get"
          action={`/registries/${encodeURIComponent(
            definition.id,
          )}/search`}
        >
          <label htmlFor="registry-overview-search">
            Search terms
          </label>
          <div>
            <input
              id="registry-overview-search"
              name="q"
              type="search"
              placeholder="Search this registry"
            />
            <button type="submit">Search</button>
          </div>
        </form>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Transparency metrics</p>
            <h2>Explore registry analytics</h2>
          </div>
          <Link
            className="metric"
            href={
              "/registries/" +
              encodeURIComponent(definition.id) +
              "/analytics"
            }
          >
            View analytics →
          </Link>
        </div>
      </section>

      <section
        className="section-block"
        aria-labelledby="record-types-heading"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">Browse by type</p>
            <h2 id="record-types-heading">Public records</h2>
          </div>
          <span className="metric">
            {definition.recordTypes.length} record{" "}
            {definition.recordTypes.length === 1
              ? "type"
              : "types"}
          </span>
        </div>

        <div className="registry-grid">
          {definition.recordTypes.map((recordType) => (
            <Link
              className="registry-card"
              key={recordType.id}
              href={`/registries/${encodeURIComponent(
                definition.id,
              )}/records?type=${encodeURIComponent(recordType.id)}`}
            >
              <span className="registry-card__kicker">
                {recordType.name}
              </span>
              <h3>{recordType.pluralName}</h3>
              <p>
                {recordType.description ??
                  `Browse public ${recordType.pluralName.toLowerCase()} in this registry.`}
              </p>
              <span className="registry-card__action">
                View records →
              </span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
