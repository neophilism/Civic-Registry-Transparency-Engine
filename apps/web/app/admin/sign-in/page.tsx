import { redirect } from "next/navigation";

import {
  adminConsoleConfigured,
  getAdminSession,
} from "../../../lib/admin-auth";
import { signInAdmin } from "../actions";

export const dynamic = "force-dynamic";

interface SignInPageProps {
  searchParams: Promise<{
    error?: string;
  }>;
}

export default async function AdminSignInPage({
  searchParams,
}: SignInPageProps) {
  if (await getAdminSession()) {
    redirect("/admin");
  }

  const { error } = await searchParams;
  const configured =
    adminConsoleConfigured();

  return (
    <main className="page-shell admin-signin">
      <section className="empty-state">
        <p className="eyebrow">
          Administrator console
        </p>
        <h1>Operator access</h1>
        <p>
          Administrative operations use a signed,
          HTTP-only session and an explicit operator
          identity. Lifecycle roles entered here are
          still checked by the configured registry
          workflow before protected transitions can run.
        </p>

        {!configured ? (
          <div className="notice">
            The console is disabled. Configure
            <code>
              CIVIC_REGISTRY_ADMIN_TOKEN
            </code>{" "}
            on the server before signing in.
          </div>
        ) : null}

        {error ? (
          <div
            className="admin-message admin-message--error"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        <form
          className="admin-form"
          action={signInAdmin}
        >
          <label>
            <span>Actor ID</span>
            <input
              name="actorId"
              required
              autoComplete="username"
              placeholder="operator@example.org"
            />
          </label>
          <label>
            <span>Lifecycle roles</span>
            <input
              name="roles"
              placeholder="editor, reviewer, publisher"
            />
            <small>
              The administrator token grants console access.
              These role strings are the operator context
              evaluated by each registry&apos;s configured
              lifecycle rules. Use organization SSO/RBAC in
              front of the console when roles must be
              identity-verified.
            </small>
          </label>
          <label>
            <span>Administrator token</span>
            <input
              name="token"
              type="password"
              required
              autoComplete="current-password"
            />
          </label>
          <div className="admin-actions">
            <button
              type="submit"
              disabled={!configured}
            >
              Sign in
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
