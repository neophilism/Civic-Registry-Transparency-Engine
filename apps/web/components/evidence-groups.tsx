import type {
  PresentedCitationGroup,
} from "@civic-registry/registry";

import { formatDateTime } from "../lib/format";

function EvidenceLink({
  href,
  children,
}: {
  href?: string;
  children: React.ReactNode;
}) {
  if (!href) return <>{children}</>;

  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

export function EvidenceGroups({
  groups,
  limitPerGroup,
}: {
  groups: PresentedCitationGroup[];
  limitPerGroup?: number;
}) {
  return (
    <div className="evidence-groups">
      {groups.map((group) => {
        const citations =
          limitPerGroup === undefined
            ? group.citations
            : group.citations.slice(0, limitPerGroup);

        return (
          <section className="evidence-group" key={group.key}>
            <div className="evidence-group__heading">
              <div>
                <span className="evidence-scope">
                  Citation scope
                </span>
                <h3>{group.label}</h3>
              </div>
              <span className="metric">
                {group.count}{" "}
                {group.count === 1 ? "citation" : "citations"}
              </span>
            </div>

            <div className="evidence-list">
              {citations.map((citation) => (
                <article
                  className="evidence-card"
                  key={citation.id}
                >
                  {citation.document ? (
                    <div className="evidence-card__primary">
                      <span>Document</span>
                      <h4>
                        <EvidenceLink
                          href={citation.document.canonicalUrl}
                        >
                          {citation.document.title}
                        </EvidenceLink>
                      </h4>
                    </div>
                  ) : citation.source ? (
                    <div className="evidence-card__primary">
                      <span>Source</span>
                      <h4>
                        <EvidenceLink
                          href={citation.source.canonicalUrl}
                        >
                          {citation.source.title}
                        </EvidenceLink>
                      </h4>
                    </div>
                  ) : null}

                  {citation.locatorLabel ? (
                    <p className="evidence-locator">
                      {citation.locatorLabel}
                    </p>
                  ) : null}

                  {citation.note ? (
                    <p className="evidence-note">
                      {citation.note}
                    </p>
                  ) : null}

                  <dl className="evidence-metadata">
                    {citation.source ? (
                      <>
                        <div>
                          <dt>Source</dt>
                          <dd>
                            <EvidenceLink
                              href={citation.source.canonicalUrl}
                            >
                              {citation.source.title}
                            </EvidenceLink>
                          </dd>
                        </div>
                        <div>
                          <dt>Source type</dt>
                          <dd>{citation.source.sourceType}</dd>
                        </div>
                        {citation.source.publishedAt ? (
                          <div>
                            <dt>Source published</dt>
                            <dd>
                              {formatDateTime(
                                citation.source.publishedAt,
                              )}
                            </dd>
                          </div>
                        ) : null}
                      </>
                    ) : null}

                    {citation.document?.fileName ? (
                      <div>
                        <dt>File</dt>
                        <dd>{citation.document.fileName}</dd>
                      </div>
                    ) : null}

                    {citation.document?.mimeType ? (
                      <div>
                        <dt>Format</dt>
                        <dd>{citation.document.mimeType}</dd>
                      </div>
                    ) : null}

                    {citation.document?.pageCount ? (
                      <div>
                        <dt>Pages</dt>
                        <dd>{citation.document.pageCount}</dd>
                      </div>
                    ) : null}

                    {citation.document?.language ? (
                      <div>
                        <dt>Language</dt>
                        <dd>{citation.document.language}</dd>
                      </div>
                    ) : null}

                    {citation.document?.sha256 ? (
                      <div className="evidence-hash">
                        <dt>SHA-256</dt>
                        <dd className="mono">
                          {citation.document.sha256}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                </article>
              ))}
            </div>

            {limitPerGroup !== undefined &&
            group.count > citations.length ? (
              <p className="evidence-more">
                {group.count - citations.length} more citation
                {group.count - citations.length === 1 ? "" : "s"} not
                shown in this summary.
              </p>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
