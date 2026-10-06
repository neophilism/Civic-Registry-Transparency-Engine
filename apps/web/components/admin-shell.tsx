import Link from "next/link";

import type {
  AdminSession,
} from "../lib/admin-auth";
import { signOutAdmin } from "../app/admin/actions";

interface AdminShellProps {
  session: AdminSession;
  title: string;
  subtitle?: string;
  registryId?: string;
  children: React.ReactNode;
}

export function AdminShell({
  session,
  title,
  subtitle,
  registryId,
  children,
}: AdminShellProps) {
  return (
    <main className="page-shell admin-shell">
      <section className="admin-bar">
        <div>
          <p className="eyebrow">Administrator console</p>
          <strong>{session.actorId}</strong>
          <span>
            {session.roles.length > 0
              ? session.roles.join(", ")
              : "No lifecycle roles declared"}
          </span>
        </div>
        <nav aria-label="Administrator navigation">
          <Link href="/admin">Registries</Link>
          {registryId ? (
            <Link
              href={
                "/registries/" +
                encodeURIComponent(registryId)
              }
            >
              Public view
            </Link>
          ) : null}
          <form action={signOutAdmin}>
            <button type="submit">Sign out</button>
          </form>
        </nav>
      </section>

      <header className="page-heading admin-heading">
        <p className="eyebrow">Operations</p>
        <h1>{title}</h1>
        {subtitle ? (
          <p className="lede">{subtitle}</p>
        ) : null}
      </header>

      {children}
    </main>
  );
}
