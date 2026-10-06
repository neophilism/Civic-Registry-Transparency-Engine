import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link className="brand" href="/">
          <span className="brand__mark" aria-hidden="true">
            CR
          </span>
          <span>
            Civic Registry
            <small>Transparency Engine</small>
          </span>
        </Link>
        <nav aria-label="Primary navigation">
          <Link href="/">Registries</Link>
        </nav>
      </div>
    </header>
  );
}
