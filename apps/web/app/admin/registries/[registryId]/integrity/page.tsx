import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminShell } from "../../../../../components/admin-shell";
import {
  requireAdminSession,
} from "../../../../../lib/admin-auth";
import {
  getAdminRegistry,
} from "../../../../../lib/admin-console";
import {
  getRepositories,
} from "../../../../../lib/database";
import { formatDateTime } from "../../../../../lib/format";

export const dynamic = "force-dynamic";

interface IntegrityAdminPageProps {
  params: Promise<{ registryId: string }>;
  searchParams: Promise<{
    verify?: string;
  }>;
}

export default async function IntegrityAdminPage({
  params,
  searchParams,
}: IntegrityAdminPageProps) {
  const session = await requireAdminSession();
  const { registryId } = await params;
  const query = await searchParams;
  const registry = await getAdminRegistry(registryId);

  if (!registry) notFound();

  const integrity = getRepositories().integrity;
  const summary =
    await integrity.getSummary(registryId);
  const verification =
    query.verify === "1"
      ? await integrity.verifyRegistry(registryId)
      : undefined;
  const verifyHref =
    "/admin/registries/" +
    encodeURIComponent(registryId) +
    "/integrity?verify=1";

  return (
    <AdminShell
      session={session}
      registryId={registryId}
      title="Audit integrity"
      subtitle="Cryptographic verification of the registry-wide immutable history chain. Signed checkpoints are created outside the web process so the private signing key does not need to be deployed here."
    >
      <section className="admin-metrics">
        <div>
          <strong>{summary.sequence}</strong>
          <span>Chain sequence</span>
        </div>
        <div>
          <strong>{summary.entryCount}</strong>
          <span>Integrity entries</span>
        </div>
        <div>
          <strong>
            {summary.recordVersionCount}
          </strong>
          <span>Record revisions</span>
        </div>
        <div>
          <strong>{summary.auditEventCount}</strong>
          <span>Audit events</span>
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              Current commitment
            </p>
            <h2>Registry chain head</h2>
          </div>
          <Link
            className="button-link"
            href={verifyHref}
          >
            Verify now
          </Link>
        </div>

        <div className="admin-card">
          <div>
            <strong>SHA-256 head</strong>
            <code>
              {summary.headHash ??
                "No integrity entries yet"}
            </code>
            <small>
              {summary.updatedAt
                ? "Updated " +
                  formatDateTime(
                    summary.updatedAt,
                  )
                : "No chain head timestamp"}
            </small>
          </div>
        </div>

        <p className="lede">
          The chain commits every immutable record
          revision and audit event. A verification
          recomputes current source payload hashes,
          chain links, entry hashes, source coverage,
          and the stored head.
        </p>
      </section>

      {verification ? (
        <section className="section-block">
          <div className="section-heading">
            <div>
              <p className="eyebrow">
                Verification result
              </p>
              <h2>
                {verification.valid
                  ? "Integrity verified"
                  : "Integrity failure detected"}
              </h2>
            </div>
            <span className="metric">
              {verification.verifiedEntries}{" "}
              entries checked
            </span>
          </div>

          {verification.valid ? (
            <div className="admin-message">
              The immutable source rows, integrity
              ledger, chain links, and current head
              are internally consistent.
            </div>
          ) : (
            <div className="admin-message admin-message--error">
              Cryptographic verification found{" "}
              {verification.issues.length} reported
              issue
              {verification.issues.length === 1
                ? ""
                : "s"}
              .
            </div>
          )}

          {verification.issues.length > 0 ? (
            <div className="admin-stack">
              {verification.issues.map(
                (issue, index) => (
                  <article
                    className="admin-card"
                    key={
                      issue.code +
                      ":" +
                      (issue.sequence ?? "none") +
                      ":" +
                      index
                    }
                  >
                    <div>
                      <strong>{issue.code}</strong>
                      <span>{issue.message}</span>
                      <small>
                        {issue.sequence
                          ? "Sequence " +
                            issue.sequence
                          : "Registry-wide check"}
                        {issue.sourceTable
                          ? " · " +
                            issue.sourceTable
                          : ""}
                        {issue.sourceKey
                          ? " · " +
                            issue.sourceKey
                          : ""}
                      </small>
                    </div>
                  </article>
                ),
              )}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              External anchoring
            </p>
            <h2>Signed checkpoints</h2>
          </div>
        </div>

        <p className="lede">
          Create checkpoints from an offline or
          restricted operational environment. The
          checkpoint is signed with Ed25519 and can
          optionally bind the exact SHA-256 and byte
          length of a database backup file.
        </p>

        <div className="admin-card">
          <div>
            <strong>Create a checkpoint</strong>
            <code>
              pnpm db:integrity-checkpoint{" "}
              {registryId} checkpoint.json
              [backup-file]
            </code>
          </div>
        </div>

        <div className="admin-card">
          <div>
            <strong>
              Verify a signed checkpoint
            </strong>
            <code>
              pnpm db:integrity-verify{" "}
              {registryId} checkpoint.json
              [backup-file]
            </code>
          </div>
        </div>

        <p className="lede">
          Store signed checkpoints separately from
          PostgreSQL—ideally in immutable/WORM
          storage or another independently controlled
          system. A database administrator who can
          rewrite both source rows and the hash chain
          cannot forge an earlier Ed25519 checkpoint
          without the signing key.
        </p>
      </section>
    </AdminShell>
  );
}
