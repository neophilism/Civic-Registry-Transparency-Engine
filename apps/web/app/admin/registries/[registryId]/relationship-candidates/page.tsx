import type {
  RegistryRecord,
} from "@civic-registry/core";
import { notFound } from "next/navigation";

import { AdminShell } from "../../../../../components/admin-shell";
import {
  reviewAdminRelationshipCandidate,
} from "../../../actions";
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

interface RelationshipCandidatesPageProps {
  params: Promise<{ registryId: string }>;
  searchParams: Promise<{
    notice?: string;
    error?: string;
  }>;
}

interface EvidenceMention {
  documentId?: string;
  citationId?: string;
  page?: number;
  matchedText?: string;
  excerpt?: string;
  matchKind?: string;
  confidence?: number;
}

function recordLabel(
  record: RegistryRecord | undefined,
  fallback: string,
): string {
  if (!record) return fallback;

  for (const key of [
    "title",
    "name",
    "citation",
    "summary",
  ]) {
    const value = record.fields[key];

    if (
      typeof value === "string" &&
      value.trim()
    ) {
      return value.trim();
    }
  }

  return record.id;
}

function evidenceMentions(
  value: Record<string, unknown>,
): EvidenceMention[] {
  const mentions = value.mentions;

  if (!Array.isArray(mentions)) {
    return [];
  }

  return mentions
    .filter(
      (entry): entry is Record<
        string,
        unknown
      > =>
        Boolean(entry) &&
        typeof entry === "object" &&
        !Array.isArray(entry),
    )
    .map((entry) => ({
      documentId:
        typeof entry.documentId ===
        "string"
          ? entry.documentId
          : undefined,
      citationId:
        typeof entry.citationId ===
        "string"
          ? entry.citationId
          : undefined,
      page:
        typeof entry.page ===
        "number"
          ? entry.page
          : undefined,
      matchedText:
        typeof entry.matchedText ===
        "string"
          ? entry.matchedText
          : undefined,
      excerpt:
        typeof entry.excerpt ===
        "string"
          ? entry.excerpt
          : undefined,
      matchKind:
        typeof entry.matchKind ===
        "string"
          ? entry.matchKind
          : undefined,
      confidence:
        typeof entry.confidence ===
        "number"
          ? entry.confidence
          : undefined,
    }));
}

export default async function RelationshipCandidatesPage({
  params,
  searchParams,
}: RelationshipCandidatesPageProps) {
  const session = await requireAdminSession();
  const { registryId } = await params;
  const query = await searchParams;
  const registry =
    await getAdminRegistry(registryId);

  if (!registry) notFound();

  const repositories =
    getRepositories();
  const [pending, approved, rejected] =
    await Promise.all([
      repositories.relationshipCandidates.list(
        registryId,
        {
          status: "pending",
          limit: 200,
        },
      ),
      repositories.relationshipCandidates.list(
        registryId,
        {
          status: "approved",
          limit: 50,
        },
      ),
      repositories.relationshipCandidates.list(
        registryId,
        {
          status: "rejected",
          limit: 50,
        },
      ),
    ]);
  const recent = [
    ...approved,
    ...rejected,
  ]
    .sort(
      (left, right) =>
        (right.reviewedAt ?? "").localeCompare(
          left.reviewedAt ?? "",
        ),
    )
    .slice(0, 50);
  const recordIds = [
    ...new Set(
      [
        ...pending,
        ...recent,
      ].flatMap((candidate) => [
        candidate.fromRecordId,
        candidate.toRecordId,
      ]),
    ),
  ];
  const records = await Promise.all(
    recordIds.map((recordId) =>
      repositories.records.get(
        registryId,
        recordId,
      ),
    ),
  );
  const recordsById =
    new Map<string, RegistryRecord>();

  records.forEach((record) => {
    if (record) {
      recordsById.set(
        record.id,
        record,
      );
    }
  });

  const returnTo =
    "/admin/registries/" +
    encodeURIComponent(registryId) +
    "/relationship-candidates";

  return (
    <AdminShell
      session={session}
      registryId={registryId}
      title="Relationship review"
      subtitle="Review machine-proposed relationships before they become canonical registry links. Proposal evidence is immutable and audit-hashed; approval materializes the ordinary relationship with reviewer attribution."
    >
      {query.notice ? (
        <div className="admin-message">
          {query.notice}
        </div>
      ) : null}
      {query.error ? (
        <div className="admin-message admin-message--error">
          {query.error}
        </div>
      ) : null}

      <section className="admin-metrics">
        <div>
          <strong>{pending.length}</strong>
          <span>Pending review</span>
        </div>
        <div>
          <strong>{approved.length}</strong>
          <span>Recent approved</span>
        </div>
        <div>
          <strong>{rejected.length}</strong>
          <span>Recent rejected</span>
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              Review queue
            </p>
            <h2>Pending candidates</h2>
          </div>
          <span className="metric">
            {pending.length} pending
          </span>
        </div>

        {pending.length === 0 ? (
          <div className="empty-state empty-state--inline">
            No relationship candidates are
            awaiting review.
          </div>
        ) : (
          <div className="admin-stack">
            {pending.map((candidate) => {
              const from =
                recordsById.get(
                  candidate.fromRecordId,
                );
              const to =
                recordsById.get(
                  candidate.toRecordId,
                );
              const mentions =
                evidenceMentions(
                  candidate.evidence,
                );
              const authorityCitation =
                typeof candidate.evidence
                  .authorityCitation ===
                "string"
                  ? candidate.evidence
                      .authorityCitation
                  : undefined;

              return (
                <article
                  className="admin-card"
                  key={candidate.id}
                >
                  <div>
                    <p className="eyebrow">
                      {
                        candidate.relationshipTypeId
                      }
                    </p>
                    <h3>
                      {recordLabel(
                        from,
                        candidate.fromRecordId,
                      )}{" "}
                      →{" "}
                      {recordLabel(
                        to,
                        candidate.toRecordId,
                      )}
                    </h3>
                    {authorityCitation ? (
                      <p>
                        Matched authority:{" "}
                        <strong>
                          {authorityCitation}
                        </strong>
                      </p>
                    ) : null}
                    <small>
                      Confidence{" "}
                      {(
                        candidate.confidence *
                        100
                      ).toFixed(1)}
                      % ·{" "}
                      {candidate.extractor}{" "}
                      {
                        candidate.extractorVersion
                      }{" "}
                      · proposed{" "}
                      {formatDateTime(
                        candidate.proposedAt,
                      )}
                    </small>
                    <small className="mono">
                      Evidence SHA-256{" "}
                      {
                        candidate.evidenceSha256
                      }
                    </small>
                  </div>

                  {mentions.length > 0 ? (
                    <div className="admin-stack">
                      {mentions
                        .slice(0, 8)
                        .map(
                          (
                            mention,
                            index,
                          ) => (
                            <div
                              className="admin-card"
                              key={
                                (mention.documentId ??
                                  "document") +
                                ":" +
                                (mention.page ??
                                  "page") +
                                ":" +
                                index
                              }
                            >
                              <strong>
                                Page{" "}
                                {mention.page ??
                                  "—"}
                                {mention.matchKind
                                  ? " · " +
                                    mention.matchKind
                                  : ""}
                              </strong>
                              {mention.matchedText ? (
                                <span className="mono">
                                  {
                                    mention.matchedText
                                  }
                                </span>
                              ) : null}
                              {mention.excerpt ? (
                                <p>
                                  “
                                  {
                                    mention.excerpt
                                  }
                                  ”
                                </p>
                              ) : null}
                              {mention.documentId ? (
                                <small className="mono">
                                  Document{" "}
                                  {
                                    mention.documentId
                                  }
                                </small>
                              ) : null}
                            </div>
                          ),
                        )}
                    </div>
                  ) : (
                    <pre className="admin-code">
                      {JSON.stringify(
                        candidate.evidence,
                        null,
                        2,
                      )}
                    </pre>
                  )}

                  <form
                    action={
                      reviewAdminRelationshipCandidate
                    }
                    className="admin-form"
                  >
                    <input
                      type="hidden"
                      name="registryId"
                      value={registryId}
                    />
                    <input
                      type="hidden"
                      name="candidateId"
                      value={candidate.id}
                    />
                    <input
                      type="hidden"
                      name="returnTo"
                      value={returnTo}
                    />
                    <label>
                      Review note
                      <textarea
                        name="note"
                        rows={2}
                        placeholder="Optional reason or verification note"
                      />
                    </label>
                    <div className="admin-actions">
                      <button
                        type="submit"
                        name="decision"
                        value="approved"
                      >
                        Approve relationship
                      </button>
                      <button
                        type="submit"
                        name="decision"
                        value="rejected"
                        className="admin-button--quiet"
                      >
                        Reject candidate
                      </button>
                    </div>
                  </form>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              Review history
            </p>
            <h2>Recent decisions</h2>
          </div>
        </div>

        {recent.length === 0 ? (
          <div className="empty-state empty-state--inline">
            No relationship candidate has
            been reviewed yet.
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Relationship</th>
                  <th>Confidence</th>
                  <th>Reviewer</th>
                  <th>Reviewed</th>
                </tr>
              </thead>
              <tbody>
                {recent.map(
                  (candidate) => (
                    <tr
                      key={candidate.id}
                    >
                      <td>
                        {candidate.status}
                      </td>
                      <td>
                        {recordLabel(
                          recordsById.get(
                            candidate.fromRecordId,
                          ),
                          candidate.fromRecordId,
                        )}
                        {" → "}
                        {recordLabel(
                          recordsById.get(
                            candidate.toRecordId,
                          ),
                          candidate.toRecordId,
                        )}
                        <small>
                          {
                            candidate.relationshipTypeId
                          }
                        </small>
                      </td>
                      <td>
                        {(
                          candidate.confidence *
                          100
                        ).toFixed(1)}
                        %
                      </td>
                      <td>
                        {candidate.reviewedBy ??
                          "—"}
                        {candidate.reviewNote ? (
                          <small>
                            {
                              candidate.reviewNote
                            }
                          </small>
                        ) : null}
                      </td>
                      <td>
                        {candidate.reviewedAt
                          ? formatDateTime(
                              candidate.reviewedAt,
                            )
                          : "—"}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AdminShell>
  );
}
