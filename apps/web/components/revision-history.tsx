import type {
  PresentedRecordRevision,
} from "@civic-registry/registry";

import { formatDateTime } from "../lib/format";
import { RecordFieldValue } from "./record-field";

function ChangeValue({
  value,
}: {
  value?: string;
}) {
  return value ? (
    <span>{value}</span>
  ) : (
    <span className="empty-value">Not provided</span>
  );
}

export function RevisionHistory({
  revisions,
}: {
  revisions: PresentedRecordRevision[];
}) {
  return (
    <div className="revision-list">
      {revisions.map((revision) => (
        <details
          className="revision-card"
          key={revision.id}
          open={revision === revisions[0]}
        >
          <summary>
            <div>
              <span className="revision-version">
                Version {revision.version}
              </span>
              <strong>{revision.operationLabel}</strong>
            </div>
            <time dateTime={revision.createdAt}>
              {formatDateTime(revision.createdAt)}
            </time>
          </summary>

          <div className="revision-card__body">
            {revision.baselineNotice ? (
              <div className="notice">
                {revision.baselineNotice}
              </div>
            ) : null}

            {revision.reason ? (
              <p className="history-reason">
                Reason: {revision.reason}
              </p>
            ) : null}

            {revision.changes.length > 0 ? (
              <section
                className="revision-changes"
                aria-labelledby={`revision-${revision.version}-changes`}
              >
                <h4
                  id={`revision-${revision.version}-changes`}
                >
                  Changes from previous visible revision
                </h4>
                <dl>
                  {revision.changes.map((change) => (
                    <div key={change.key}>
                      <dt>{change.label}</dt>
                      <dd>
                        <div>
                          <span>Before</span>
                          <ChangeValue value={change.before} />
                        </div>
                        <div>
                          <span>After</span>
                          <ChangeValue value={change.after} />
                        </div>
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ) : null}

            <section className="revision-snapshot">
              <div className="revision-snapshot__heading">
                <div>
                  <p className="eyebrow">Immutable snapshot</p>
                  <h4>{revision.record.title}</h4>
                </div>
                <span className="status-pill">
                  {revision.record.status}
                </span>
              </div>

              <dl className="detail-list">
                {revision.record.fields.map((field) => (
                  <div key={field.id}>
                    <dt>{field.label}</dt>
                    <dd>
                      <RecordFieldValue
                        field={field}
                        registryId={revision.record.registryId}
                      />
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
        </details>
      ))}
    </div>
  );
}
