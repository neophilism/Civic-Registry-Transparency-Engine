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
