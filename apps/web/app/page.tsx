const principles = [
  "Schema-driven registries",
  "Primary-source traceability",
  "Auditable record history",
  "Open APIs and exports",
];

export default function HomePage() {
  return (
    <main>
      <section className="hero">
        <p className="eyebrow">Foundation build</p>
        <h1>Civic Registry &amp; Transparency Engine</h1>
        <p className="lede">
          A reusable foundation for public-interest registries, transparency
          workflows, statutory deadlines, source documents, and downstream
          civic applications.
        </p>
      </section>

      <section aria-labelledby="principles-heading">
        <h2 id="principles-heading">Engine principles</h2>
        <ul className="principles">
          {principles.map((principle) => (
            <li key={principle}>{principle}</li>
          ))}
        </ul>
      </section>

      <section className="status" aria-labelledby="status-heading">
        <h2 id="status-heading">Current milestone</h2>
        <p>
          PR 1 establishes the repository, development environment, continuous
          integration, health endpoint, and architectural conventions. Generic
          registry domain modeling begins in PR 2.
        </p>
      </section>
    </main>
  );
}
