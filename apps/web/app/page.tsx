import Link from "next/link";

import { listPublicRegistries } from "../lib/public-registry";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const registries = await listPublicRegistries();

  return (
    <main className="page-shell">
      <section className="hero">
        <p className="eyebrow">Open civic infrastructure</p>
        <h1>Public records should be understandable.</h1>
        <p className="lede">
          A configurable engine for searchable public registries,
          transparent record structures, and source-driven civic
          information.
        </p>
      </section>

      <section
        className="section-block"
        aria-labelledby="registries-heading"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">Installed registries</p>
            <h2 id="registries-heading">
              Browse public information
            </h2>
          </div>
          <span className="metric">
            {registries.length}{" "}
            {registries.length === 1 ? "registry" : "registries"}
          </span>
        </div>

        {registries.length > 0 ? (
          <div className="registry-grid">
            {registries.map(({ config }) => {
              const definition = config.definition;

              const href =
                definition.id ===
                "open-legal-interpretations"
                  ? "/open-legal-interpretations"
                  : `/registries/${encodeURIComponent(
                      definition.id,
                    )}`;

              return (
                <Link
                  className="registry-card"
                  key={definition.id}
                  href={href}
                >
                  <span className="registry-card__kicker">
                    Public registry
                  </span>
                  <h3>{definition.name}</h3>
                  <p>
                    {definition.description ??
                      "Browse the public records configured for this registry."}
                  </p>
                  <div className="registry-card__footer">
                    <span>
                      {definition.recordTypes.length}{" "}
                      {definition.recordTypes.length === 1
                        ? "record type"
                        : "record types"}
                    </span>
                    <span className="registry-card__action">
                      Open registry →
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="empty-state empty-state--inline">
            <h3>No registries are installed yet</h3>
            <p>
              Apply the database migrations and seed a registry
              configuration to make it available here.
            </p>
            <code>
              pnpm db:seed -- examples/generic-registry/registry.yaml
              examples/generic-registry/seed.json
            </code>
          </div>
        )}
      </section>

      <section className="principle-strip" aria-label="Engine principles">
        <div>
          <strong>Schema-driven</strong>
          <span>Record types and fields come from configuration.</span>
        </div>
        <div>
          <strong>Source-ready</strong>
          <span>Built for traceable public information.</span>
        </div>
        <div>
          <strong>Reusable</strong>
          <span>One engine can power many civic applications.</span>
        </div>
      </section>
    </main>
  );
}
