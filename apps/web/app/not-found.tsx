import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page-shell">
      <section className="empty-state">
        <p className="eyebrow">Not found</p>
        <h1>The requested public record is unavailable.</h1>
        <p>
          It may not exist, may have moved, or may not be
          publicly visible.
        </p>
        <Link className="button-link" href="/">
          Browse registries
        </Link>
      </section>
    </main>
  );
}
